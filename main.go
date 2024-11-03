package main

import (
	"encoding/json"
	"encoding/base64"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Client struct {
	conn     *websocket.Conn
	nickname string
	room     *Room
	isDrawer bool
}

type Room struct {
	Code      string
	Clients   map[*Client]bool
	Drawer    *Client
	Word      string
	mu        sync.Mutex
	StartTime time.Time
}

var rooms = make(map[string]*Room)

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	defer conn.Close()

	client := &Client{conn: conn}

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println(err)
			return
		}

		var data map[string]interface{}
		if err := json.Unmarshal(msg, &data); err != nil {
			log.Println(err)
			continue
		}

		switch data["type"] {
		case "join_room":
			handleJoinRoom(client, data)
		case "leave_room":
			handleLeaveRoom(client)
		case "chat":
			handleChatMessage(client, data)
		case "draw":
			handleDrawing(client, data)
		case "start_game":
			handleStartGame(client)
		case "draw_image":
			handleDrawImage(client, data)
		}
	}
}

func handleDrawImage(client *Client, data map[string]interface{}) {
	if client.room == nil || !client.isDrawer {
		return
	}

	imageData, ok := data["imageData"].(string)
	if !ok {
		log.Println("Invalid image data")
		return
	}

	// Vérifier si l'image est en base64
	_, err := base64.StdEncoding.DecodeString(imageData)
	if err != nil {
		log.Println("Invalid base64 image data")
		return
	}

	broadcastToRoom(client.room, map[string]interface{}{
		"type":      "draw_image",
		"imageData": imageData,
	})
}

func handleJoinRoom(client *Client, data map[string]interface{}) {
	roomCode := data["roomCode"].(string)
	client.nickname = data["nickname"].(string)

	room, ok := rooms[roomCode]
	if !ok {
		room = &Room{
			Code:    roomCode,
			Clients: make(map[*Client]bool),
		}
		rooms[roomCode] = room
	}

	room.mu.Lock()
	room.Clients[client] = true
	client.room = room
	isFirstPlayer := len(room.Clients) == 1
	room.mu.Unlock()

	players := getPlayersInRoom(room)

	client.conn.WriteJSON(map[string]interface{}{
		"type":     "room_joined",
		"roomCode": roomCode,
		"players":  players,
	})

	if isFirstPlayer {
		client.isDrawer = true
		client.conn.WriteJSON(map[string]interface{}{
			"type": "you_are_drawer",
		})
	}

	broadcastToRoom(room, map[string]interface{}{
		"type":    "player_joined",
		"players": players,
	})
}

func handleLeaveRoom(client *Client) {
	if client.room == nil {
		return
	}

	room := client.room
	room.mu.Lock()
	delete(room.Clients, client)
	wasDrawer := client == room.Drawer
	client.room = nil
	room.mu.Unlock()

	players := getPlayersInRoom(room)

	if len(players) == 0 {
		delete(rooms, room.Code)
	} else {
		if wasDrawer {
			selectNewDrawer(room)
		}
		broadcastToRoom(room, map[string]interface{}{
			"type":    "player_left",
			"players": players,
		})
	}

	client.conn.WriteJSON(map[string]interface{}{
		"type": "room_left",
	})
}

func handleChatMessage(client *Client, data map[string]interface{}) {
	if client.room == nil {
		return
	}

	message := data["message"].(string)
	if message == client.room.Word && !client.isDrawer {
		handleCorrectGuess(client)
	} else {
		broadcastToRoom(client.room, map[string]interface{}{
			"type":    "chat_message",
			"sender":  client.nickname,
			"message": message,
		})
	}
}

func handleDrawing(client *Client, data map[string]interface{}) {
	if client.room == nil || !client.isDrawer {
		return
	}

	broadcastToRoom(client.room, map[string]interface{}{
		"type": "draw",
		"x":    data["x"],
		"y":    data["y"],
		"isDragging": data["isDragging"],
		"color":      data["color"],
		"lineWidth":  data["lineWidth"],
		"tool":       data["tool"],
	})
}

func handleStartGame(client *Client) {
	if client.room == nil || !client.isDrawer {
		return
	}

	room := client.room
	room.Word = getRandomWord()
	room.StartTime = time.Now()

	client.conn.WriteJSON(map[string]interface{}{
		"type": "word_to_draw",
		"word": room.Word,
	})

	broadcastToRoom(room, map[string]interface{}{
		"type": "game_started",
	})
}

func handleCorrectGuess(client *Client) {
	room := client.room
	elapsedTime := time.Since(room.StartTime)
	
	broadcastToRoom(room, map[string]interface{}{
		"type":    "correct_guess",
		"winner":  client.nickname,
		"word":    room.Word,
		"time":    elapsedTime.Seconds(),
	})

	selectNewDrawer(room)
}

func selectNewDrawer(room *Room) {
	room.mu.Lock()
	defer room.mu.Unlock()

	if room.Drawer != nil {
		room.Drawer.isDrawer = false
	}

	clients := make([]*Client, 0, len(room.Clients))
	for client := range room.Clients {
		clients = append(clients, client)
	}

	if len(clients) > 0 {
		newDrawer := clients[rand.Intn(len(clients))]
		room.Drawer = newDrawer
		newDrawer.isDrawer = true

		newDrawer.conn.WriteJSON(map[string]interface{}{
			"type": "you_are_drawer",
		})

		broadcastToRoom(room, map[string]interface{}{
			"type":   "new_drawer",
			"drawer": newDrawer.nickname,
		})
	}
}

func getPlayersInRoom(room *Room) []string {
	players := []string{}
	for client := range room.Clients {
		players = append(players, client.nickname)
	}
	return players
}

func broadcastToRoom(room *Room, message interface{}) {
	room.mu.Lock()
	defer room.mu.Unlock()

	for client := range room.Clients {
		client.conn.WriteJSON(message)
	}
}

var words = []string{
	"Chat", "Chien", "Maison", "Arbre", "Voiture", "Soleil", "Lune", "Étoile", "Montagne", "Rivière", "Plage", "Cerf-volant", "Bateau", "Train", "Avion", "Ballon", "Livre", "Ordinateur", "Téléphone",
	"Caméra", "Montre", "Tasse", "Fleurs", "Gâteau", "Chocolat", "Pizza", "Hamburger", "Glace", "Fromage", "Salade", "Paysage", "Musique", "Danse", "Peinture", "Film", "Jeu", "Robot", "Monstre", 
	"Super-héros", "Pirate", "Sirène", "Fée", "Château", "Dragon", "Safari", "École", "Sport", "Voyage", "Vacances", "Amis",
}

func getRandomWord() string {
	rand.Seed(time.Now().UnixNano())
	return words[rand.Intn(len(words))]
}

func main() {
	rand.Seed(time.Now().UnixNano())
	http.Handle("/", http.FileServer(http.Dir("./static")))
	http.HandleFunc("/ws", handleWebSocket)

	fmt.Println("Server is running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}