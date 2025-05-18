const express = require("express");
const cors = require("cors");
const userRoute = require("./Routes/userRoute");
const walletRoute = require("./wallet"); 
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();
const bodyParser = require("body-parser");
const { ethers } = require("ethers");
const multer = require("multer");
const fs = require('fs');
const { v4: uuidv4 } = require("uuid");
const uploadFolder = './uploads';

// تأكد ان مجلد uploads موجود
if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../client")));
app.use("/api/wallet", walletRoute);
app.use('/uploads', express.static(uploadFolder));

// إعداد المجلد لحفظ الملفات المرفوعة
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// التعامل مع رفع الملفات
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'لم يتم رفع الملف' });
    }

    const fileUrl = '/uploads/' + req.file.filename;
    const fileType = path.extname(req.file.originalname).toLowerCase();

    io.emit('chat message', {
        type: 'file',
        name: req.file.originalname,
        url: fileUrl,
        fileType: fileType
    });

    return res.json({
        type: 'file', 
        name: req.file.originalname, 
        url: fileUrl,
        fileType: fileType
    });
});

const db = require('./db');
const MessageModel = require("./Models/messageModel");
const userController = require("./Controllers/userController");

// User routes
app.post("/api/users/register", userController.registerUser);
app.post("/api/users/login", userController.loginUser);
app.use("/api/users", userRoute);

// Routes for chat rooms
app.get("/create", (req, res) => {
  const roomId = uuidv4();
  res.redirect(`/chat-p2p/${roomId}`);
});

app.get("/chat/:room", (req, res) => {
  res.sendFile(path.join(__dirname, "../client", "chat.html"));
});

// Static files
app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "../client", "login.html"));
});

app.get("/chat", (req, res) => {
    res.sendFile(path.join(__dirname, "../client", "chat.html"));
});

app.get("/chat-p2p/:room", (req, res) => {
    res.sendFile(path.join(__dirname, "../client", "chat-p2p.html"));
});

app.get("/chat-p2p", (req, res) => {
    res.sendFile(path.join(__dirname, "../client", "chat-p2p.html"));
});
// Socket.io Connection
io.on("connection", (socket) => {
    console.log("New user connected:", socket.id);

    // Join room handler (simple version)
    socket.on("join-room", (roomId) => {
        socket.join(roomId);

        socket.on("message", (msg) => {
            socket.to(roomId).emit("message", msg);
        });
    });

    // Join room handler (advanced version)
    socket.on('joinRoom', async ({ username, room }, callback) => {
        try {
            if (!username || !room) {
                if (callback) callback({ error: "Username and room are required" });
                return;
            }

            socket.join(room);
            console.log(`${username} joined room: ${room}`);

            // Fetch previous messages
            const messages = await MessageModel.getMessagesByRoom(room);
            socket.emit('previousMessages', messages);

            // Notify room about new user
            socket.to(room).emit('message', {
                username: 'System',
                text: `${username} has joined the room`,
                timestamp: new Date()
            });

            // Update user count
            updateUserCount(room);

            if (callback) callback({ status: "success" });
        } catch (error) {
            console.error("Join room error:", error);
            if (callback) callback({ error: "Failed to join room" });
        }
    });

    // Chat message handler
    socket.on('chatMessage', async (messageData, callback) => {
        try {
            const { text, room, username, replyTo, mediaUrl, mediaType } = messageData;

            if ((!text && !mediaUrl) || !room || !username) {
                if (callback) callback({ error: "Missing required fields" });
                return;
            }

            // Prepare reply data
            let replyData = null;
            if (replyTo) {
                try {
                    replyData = typeof replyTo === 'string' ? JSON.parse(replyTo) : replyTo;
                } catch (e) {
                    console.error("Error parsing reply data:", e);
                }
            }

            // Save message to database
            const newMessage = await MessageModel.saveMessage({
                text,
                username,
                room,
                mediaUrl: mediaUrl || null,
                mediaType: mediaType || null,
                replyToUsername: replyData?.username || null,
                replyToText: replyData?.text || null,
                timestamp: new Date()
            });

            // Broadcast message to room
            const messageToSend = {
                id: newMessage.insertId,
                text,
                username,
                room,
                mediaUrl,
                mediaType,
                replyTo: replyData,
                timestamp: new Date()
            };

            io.to(room).emit('message', messageToSend);

            if (callback) callback({ 
                status: "success", 
                messageId: newMessage.insertId 
            });
        } catch (error) {
            console.error("Message send error:", error);
            if (callback) callback({ error: "Failed to send message" });
        }
    });

    socket.on('uploadFile', async (data, callback) => {
        try {
            const { room, username, mediaType, mediaUrl, fileName } = data;
    
            if (!room || !username || !mediaUrl || !mediaType) {
                if (callback) callback({ error: "Missing fields" });
                return;
            }
    
            // حفظ الملف كرسالة في الداتا بيز
            const newMessage = await MessageModel.saveMessage({
                text: null,
                username,
                room,
                mediaUrl,
                mediaType,
                replyTo: null,
                timestamp: new Date()
            });
    
            const messageToSend = {
                id: newMessage.insertId,
                text: null,
                username,
                room,
                mediaUrl,
                mediaType,
                timestamp: new Date()
            };
    
            io.to(room).emit('message', messageToSend);
    
            if (callback) callback({ status: "success", messageId: newMessage.insertId });
    
        } catch (error) {
            console.error("Error saving uploaded file message:", error);
            if (callback) callback({ error: "Failed to save uploaded file" });
        }
    });
    
    // Leave room handler
    socket.on('leaveRoom', (room) => {
        socket.leave(room);
        updateUserCount(room);
    });

    // Disconnect handler
    socket.on('disconnect', () => {
        console.log("User disconnected:", socket.id);
    });

    // Helper function to update user count
    function updateUserCount(room) {
        const roomUsers = io.sockets.adapter.rooms.get(room);
        const userCount = roomUsers ? roomUsers.size : 0;
        io.to(room).emit('roomUserCount', { room, count: userCount });
    }
});

// Start server
const port = process.env.PORT || 5000;
server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});