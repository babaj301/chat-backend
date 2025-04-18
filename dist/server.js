"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
require("dotenv/config");
const multer_1 = __importDefault(require("multer"));
const multer_storage_cloudinary_1 = require("multer-storage-cloudinary");
const cloudinary_1 = __importDefault(require("./cloudinary"));
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");
const prisma = new PrismaClient();
const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "https://chat-frontend-ten-opal.vercel.app",
            "http://localhost:3000",
        ],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        credentials: true,
    },
});
const ADMIN_PASSWORD = "123456";
const storage = new multer_storage_cloudinary_1.CloudinaryStorage({
    cloudinary: cloudinary_1.default,
    params: (req, file) => __awaiter(void 0, void 0, void 0, function* () {
        return ({
            folder: "chatty",
            allowedFormats: ["jpg", "png", "jpeg"],
        });
    }),
});
const upload = (0, multer_1.default)({ storage });
app.use(cors({
    origin: [
        "https://chat-frontend-ten-opal.vercel.app",
        "http://localhost:3000",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
}));
app.use(express.json());
// Basic route
app.get("/", (req, res) => {
    res.send("Chat API is running");
});
// Get all chat rooms
app.get("/rooms", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    console.log("Fetching rooms");
    try {
        const rooms = yield prisma.room.findMany({
            orderBy: {
                createdAt: "desc",
            },
        });
        res.status(200).json(rooms);
    }
    catch (error) {
        console.error("Error fetching rooms:", error);
        res.status(500).json({
            error: "Failed to fetch rooms",
        });
    }
}));
// To upload an image
app.post("/upload", upload.single("file"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const imageUrl = (_a = req.file) === null || _a === void 0 ? void 0 : _a.path;
        const { userId, roomId } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ error: "No image uploaded" });
        }
        const image = yield prisma.image.create({
            data: {
                url: imageUrl,
                userId,
                roomId,
            },
        });
        const message = yield prisma.message.create({
            data: {
                text: "",
                imageUrl,
                userId,
                roomId,
                isSystem: false,
            },
            include: {
                user: true,
            },
        });
        // Emit the new message to all users in the room
        io.to(`room_${roomId}`).emit("newMessage", message);
        // Send the image back to the client
        res.status(201).json(image);
    }
    catch (error) {
        console.error("Error uploading image:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
// Create a room
app.post("/rooms", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, adminId } = req.body;
        if (!name) {
            return res.status(400).json({ error: "Room name is required" });
        }
        const newRoom = yield prisma.room.create({
            data: {
                name,
                adminId: adminId || null,
            },
        });
        res.status(201).json(newRoom);
    }
    catch (error) {
        console.error("Error creating room:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
// Create or get a user with admin authentication
app.post("/users", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, isAdmin, adminPassword } = req.body;
        if (!name) {
            return res.status(400).json({ error: "User name is required" });
        }
        // If requesting admin privileges, verify password
        if (isAdmin && adminPassword !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: "Invalid admin password" });
        }
        let user = yield prisma.user.findUnique({
            where: { name },
        });
        if (user) {
            // If user exists and is requesting admin, update their status
            if (isAdmin && adminPassword === ADMIN_PASSWORD && !user.isAdmin) {
                user = yield prisma.user.update({
                    where: { id: user.id },
                    data: { isAdmin: true },
                });
                console.log(`User ${name} upgraded to admin status`);
            }
        }
        else {
            // Create new user with appropriate admin status
            user = yield prisma.user.create({
                data: {
                    name,
                    isAdmin: isAdmin && adminPassword === ADMIN_PASSWORD,
                },
            });
            console.log(`Created new user: ${name}${user.isAdmin ? " (admin)" : ""}`);
        }
        res.json(user);
    }
    catch (error) {
        console.error("Error with user:", error);
        res.status(500).json({ error: "Failed to process user" });
    }
}));
// Socket.IO connection handling
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    // Handle room creation
    socket.on("createRoom", (_a) => __awaiter(void 0, [_a], void 0, function* ({ name, adminId }) {
        try {
            const newRoom = yield prisma.room.create({
                data: {
                    name,
                    adminId: adminId || null,
                },
            });
            // Broadcast new room to all clients
            io.emit("roomCreated", newRoom);
            socket.emit("roomCreationSuccess", newRoom);
        }
        catch (error) {
            console.error("Error creating room:", error);
            socket.emit("error", "Failed to create room");
        }
    }));
    // Handle joining a room
    socket.on("joinRoom", (_a) => __awaiter(void 0, [_a], void 0, function* ({ roomId, userId, username }) {
        try {
            console.log(`${username} (${userId}) attempting to join room ${roomId}`);
            // Verify room exists
            const room = yield prisma.room.findUnique({
                where: { id: roomId },
                include: { admin: true },
            });
            if (!room) {
                return socket.emit("error", "Room not found");
            }
            const roomChannel = `room_${roomId}`;
            // Check if the user is already in the room
            const isAlreadyInRoom = socket.rooms.has(roomChannel);
            if (isAlreadyInRoom) {
                console.log(`${username} is already in room ${roomId}, skipping join message.`);
            }
            else {
                // Leave previous rooms only if not already in this one
                const socketRooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
                socketRooms.forEach((r) => socket.leave(r));
                // Join the new room
                socket.join(roomChannel);
                // Check if a system message already exists for this user
                const existingJoinMessage = yield prisma.message.findFirst({
                    where: {
                        roomId,
                        text: `${username} has joined the room`,
                        isSystem: true,
                    },
                });
                if (!existingJoinMessage) {
                    // Create system message for first-time joins only
                    const systemMessage = yield prisma.message.create({
                        data: {
                            text: `${username} has joined the room`,
                            isSystem: true,
                            roomId,
                            userId: null,
                        },
                        include: { user: true },
                    });
                    // Broadcast join message to room
                    io.to(roomChannel).emit("newMessage", systemMessage);
                }
            }
            // Get recent messages
            const messages = yield prisma.message.findMany({
                where: { roomId },
                orderBy: { createdAt: "asc" },
                take: 50,
                include: { user: true },
            });
            // Send room info and messages to the user
            socket.emit("roomJoined", { room, messages });
            console.log(`${username} successfully joined ${room.name}`);
        }
        catch (error) {
            console.error("Error joining room:", error);
            socket.emit("error", "Failed to join room");
        }
    }));
    // Handle sending messages
    socket.on("sendMessage", (_a) => __awaiter(void 0, [_a], void 0, function* ({ roomId, userId, text, isAdmin }) {
        try {
            if (!roomId || !userId || !text) {
                return socket.emit("error", "Missing required message data");
            }
            // Verify user exists
            const user = yield prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                return socket.emit("error", "User not found");
            }
            // Verify room exists
            const room = yield prisma.room.findUnique({
                where: { id: roomId },
            });
            if (!room) {
                return socket.emit("error", "Room not found");
            }
            // For admin messages, verify the user is an admin
            if (isAdmin && !user.isAdmin && room.adminId !== userId) {
                return socket.emit("error", "Not authorized to send admin messages");
            }
            // Save message to database
            const newMessage = yield prisma.message.create({
                data: {
                    text,
                    userId,
                    roomId,
                    isAdmin: isAdmin && (user.isAdmin || room.adminId === userId),
                },
                include: { user: true },
            });
            // Broadcast to everyone in the room
            io.to(`room_${roomId}`).emit("newMessage", newMessage);
        }
        catch (error) {
            console.error("Error sending message:", error);
            socket.emit("error", "Failed to send message");
        }
    }));
    // Delete a message
    // Delete a message
    socket.on("deleteMessage", (_a) => __awaiter(void 0, [_a], void 0, function* ({ messageId, userId }) {
        try {
            // Find the message first to check permissions
            const message = yield prisma.message.findUnique({
                where: { id: messageId },
                include: { room: true },
            });
            if (!message) {
                return socket.emit("error", "Message not found");
            }
            // Get user info
            const user = yield prisma.user.findUnique({
                where: { id: userId },
            });
            // Check if user is authorized to delete this message
            // Only message author, room admin, or system admin can delete messages
            if (message.userId !== userId &&
                message.room.adminId !== userId &&
                !user.isAdmin) {
                return socket.emit("error", "Not authorized to delete this message");
            }
            yield prisma.message.delete({
                where: { id: messageId },
            });
            // Broadcast to room that message was deleted
            io.to(`room_${message.roomId}`).emit("messageDeleted", { messageId });
        }
        catch (error) {
            console.error("Error deleting message:", error);
            socket.emit("error", "Failed to delete message");
        }
    }));
    // Handle user typing
    socket.on("typing", ({ roomId, username }) => {
        socket.to(`room_${roomId}`).emit("userTyping", { username });
    });
    // Handle disconnection
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
