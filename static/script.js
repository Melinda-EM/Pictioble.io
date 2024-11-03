        let socket;
        let nickname;
        let currentRoom;
        let isDrawer = false;
        let canvas, ctx;
        let isDrawing = false;
        let currentColor = 'black';
        let currentTool = 'pen';
        let startX, startY;
        let drawingHistory = [];

        const colors = ['black', 'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'brown', 'pink', 'gray'];

        function connectWebSocket() {
            socket = new WebSocket("ws://localhost:8080/ws");

            socket.onopen = function(event) {
                console.log("WebSocket connection established");
            };

            socket.onmessage = function(event) {
                console.log("Message received:", event.data);
                let data = JSON.parse(event.data);
                handleServerMessage(data);
            };

            socket.onclose = function(event) {
                console.log("WebSocket connection closed");
            };

            socket.onerror = function(error) {
                console.error("WebSocket error:", error);
            };
        }

        function joinRoom() {
            nickname = document.getElementById("nickname").value;
            currentRoom = document.getElementById("roomCode").value;

            if (!socket || socket.readyState !== WebSocket.OPEN) {
                connectWebSocket();
            }

            socket.send(JSON.stringify({
                type: "join_room",
                nickname: nickname,
                roomCode: currentRoom
            }));
        }

        function leaveRoom() {
            socket.send(JSON.stringify({
                type: "leave_room"
            }));
        }

        function sendMessage() {
            let message = document.getElementById("chatInput").value;
            socket.send(JSON.stringify({
                type: "chat",
                message: message
            }));
            document.getElementById("chatInput").value = "";
        }

        function startGame() {
            socket.send(JSON.stringify({
                type: "start_game"
            }));
        }

        function handleServerMessage(data) {
            switch(data.type) {
                case "room_joined":
                    document.getElementById("login").style.display = "none";
                    document.getElementById("game").style.display = "block";
                    document.getElementById("roomCodeDisplay").textContent = data.roomCode;
                    updatePlayersList(data.players);
                    initCanvas();
                    initColorPalette();
                    break;
                case "player_joined":
                case "player_left":
                    updatePlayersList(data.players);
                    break;
                case "chat_message":
                    addChatMessage(data.sender, data.message);
                    break;
                case "room_left":
                    document.getElementById("login").style.display = "block";
                    document.getElementById("game").style.display = "none";
                    document.getElementById("chatMessages").innerHTML = "";
                    document.getElementById("wordDisplay").textContent = "";
                    isDrawer = false;
                    document.getElementById("startGameBtn").style.display = "none";
                    document.getElementById("drawingTools").style.display = "none";
                    break;
                case "you_are_drawer":
                    isDrawer = true;
                    document.getElementById("startGameBtn").style.display = "block";
                    document.getElementById("drawingTools").style.display = "block";
                    break;
                case "word_to_draw":
                    document.getElementById("wordDisplay").textContent = "Word to draw: " + data.word;
                    break;
                case "game_started":
                    if (!isDrawer) {
                        document.getElementById("wordDisplay").textContent = "Guess the word!";
                        document.getElementById("drawingTools").style.display = "none";
                    }
                    clearCanvas();
                    break;
                case "draw":
                    if (!isDrawer) {
                        drawOnCanvas(data.x, data.y, data.isDragging, data.color, data.lineWidth, data.tool, data.startX, data.startY);
                    }
                    break;
                case "draw_image":
                    drawImageOnCanvas(data.imageData);
                    break;
                case "correct_guess":
                    addChatMessage("System", `${data.winner} guessed the word '${data.word}' correctly in ${data.time.toFixed(2)} seconds!`);
                    clearCanvas();
                    document.getElementById("wordDisplay").textContent = "";
                    break;
                case "new_drawer":
                    addChatMessage("System", `${data.drawer} is the new drawer!`);
                    if (data.drawer === nickname) {
                        isDrawer = true;
                        document.getElementById("startGameBtn").style.display = "block";
                        document.getElementById("drawingTools").style.display = "block";
                    } else {
                        isDrawer = false;
                        document.getElementById("startGameBtn").style.display = "none";
                        document.getElementById("drawingTools").style.display = "none";
                    }
                    break;
            }
        }

        function updatePlayersList(players) {
            let playersList = document.getElementById("playersList");
            playersList.innerHTML = "<h3>Players:</h3>";
            players.forEach(player => {
                playersList.innerHTML += "<p>" + player + "</p>";
            });
        }

        function addChatMessage(sender, message) {
            let chatMessages = document.getElementById("chatMessages");
            chatMessages.innerHTML += "<p><strong>" + sender + ":</strong> " + message + "</p>";
        }

        function initCanvas() {
            canvas = document.getElementById("canvas");
            ctx = canvas.getContext("2d");
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            canvas.addEventListener("mousedown", startDrawing);
            canvas.addEventListener("mousemove", draw);
            canvas.addEventListener("mouseup", stopDrawing);
            canvas.addEventListener("mouseout", stopDrawing);
        }

        function initColorPalette() {
            let colorPalette = document.getElementById("colorPalette");
            colors.forEach(color => {
                let colorOption = document.createElement("div");
                colorOption.className = "color-option";
                colorOption.style.backgroundColor = color;
                colorOption.onclick = () => setColor(color);
                colorPalette.appendChild(colorOption);
            });
        }

        function setColor(color) {
            currentColor = color;
        }

        function setTool(tool) {
            currentTool = tool;
        }

        function updateLineWidth() {
            ctx.lineWidth = document.getElementById("lineWidth").value;
        }

        function uploadImage() {
            const input = document.getElementById('imageUpload');
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const imageData = e.target.result.split(',')[1]; // Obtenir seulement la partie base64
                    socket.send(JSON.stringify({
                        type: "draw_image",
                        imageData: imageData
                    }));
                    drawImageOnCanvas(imageData);
                };
                reader.readAsDataURL(file);
            }
        }

        function drawImageOnCanvas(imageData) {
            const img = new Image();
            img.onload = function() {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = "data:image/png;base64," + imageData;
        }

        function startDrawing(e) {
            if (!isDrawer) return;
            isDrawing = true;
            [startX, startY] = [e.offsetX, e.offsetY];
            draw(e);
        }

        function draw(e) {
            if (!isDrawer || !isDrawing) return;
            
            let x = e.offsetX;
            let y = e.offsetY;

            ctx.strokeStyle = currentColor;
            ctx.fillStyle = currentColor;
            ctx.lineWidth = document.getElementById("lineWidth").value;

            switch (currentTool) {
                case 'pen':
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                    break;
                case 'eraser':
                    ctx.strokeStyle = 'white';
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                    break;
                case 'rectangle':
                    ctx.beginPath();
                    ctx.rect(startX, startY, x - startX, y - startY);
                    ctx.stroke();
                    break;
                case 'circle':
                    let radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
                    ctx.beginPath();
                    ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                    break;
            }

            startX = x;
            startY = y;

            socket.send(JSON.stringify({
                type: "draw",
                x: x,
                y: y,
                isDragging: true,
                color: currentColor,
                lineWidth: ctx.lineWidth,
                tool: currentTool,
                startX: startX,
                startY: startY
            }));

            drawingHistory.push({
                x: x,
                y: y,
                isDragging: true,
                color: currentColor,
                lineWidth: ctx.lineWidth,
                tool: currentTool,
                startX: startX,
                startY: startY
            });
        }

        function stopDrawing() {
            if (!isDrawer) return;
            isDrawing = false;
            socket.send(JSON.stringify({
                type: "draw",
                isDragging: false
            }));
        }

        function drawOnCanvas(x, y, isDragging, color, lineWidth, tool, startX, startY) {
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = lineWidth;

            if (!isDragging) {
                ctx.beginPath();
                return;
            }

            switch (tool) {
                case 'pen':
                    ctx.lineTo(x, y);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    break;
                case 'eraser':
                    ctx.strokeStyle = 'white';
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(x, y);
                    ctx.stroke();
                    break;
                case 'rectangle':
                    ctx.beginPath();
                    ctx.strokeRect(startX, startY, x - startX, y - startY);
                    ctx.stroke();
                    break;
                case 'circle':
                    let radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
                    ctx.beginPath();
                    ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
                    ctx.stroke();
                    break;
            }
        }

        function clearCanvas() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawingHistory = [];
        }

        function redrawCanvas() {
            clearCanvas();
            drawingHistory.forEach(item => {
                drawOnCanvas(item.x, item.y, item.isDragging, item.color, item.lineWidth, item.tool, item.startX, item.startY);
            }); 
        }

        connectWebSocket();