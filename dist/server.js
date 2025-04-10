"use strict";
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
require("dotenv/config");
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");
const prisma = new PrismaClient();
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://chat-frontend-ten-opal.vercel.app, http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  },
});
const ADMIN_PASSWORD = "123456";
app.use(
  cors({
    origin: "https://chat-frontend-ten-opal.vercel.app, http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  })
);
app.use(express.json());
// Basic route
app.get("/", (req, res) => {
  res.send("Chat API is running");
});
// Get all chat rooms
app.get("/rooms", (req, res) =>
  __awaiter(void 0, void 0, void 0, function* () {
    console.log("Fetching rooms");
    try {
      const rooms = yield prisma.room.findMany({
        orderBy: {
          createdAt: "desc",
        },
      });
      res.status(200).json(rooms);
    } catch (error) {
      console.error("Error fetching rooms:", error);
      res.status(500).json({
        error: "Failed to fetch rooms",
      });
    }
  })
);
// Create a room
app.post("/rooms", (req, res) =>
  __awaiter(void 0, void 0, void 0, function* () {
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
    } catch (error) {
      console.error("Error creating room:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  })
);
// Create or get a user with admin authentication
app.post("/users", (req, res) =>
  __awaiter(void 0, void 0, void 0, function* () {
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
      } else {
        // Create new user with appropriate admin status
        user = yield prisma.user.create({
          data: {
            name,
            isAdmin: isAdmin && adminPassword === ADMIN_PASSWORD,
          },
        });
        console.log(
          `Created new user: ${name}${user.isAdmin ? " (admin)" : ""}`
        );
      }
      res.json(user);
    } catch (error) {
      console.error("Error with user:", error);
      res.status(500).json({ error: "Failed to process user" });
    }
  })
);
// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  // Handle room creation
  socket.on("createRoom", (_a) =>
    __awaiter(void 0, [_a], void 0, function* ({ name, adminId }) {
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
      } catch (error) {
        console.error("Error creating room:", error);
        socket.emit("error", "Failed to create room");
      }
    })
  );
  // Handle joining a room
  socket.on("joinRoom", (_a) =>
    __awaiter(void 0, [_a], void 0, function* ({ roomId, userId, username }) {
      try {
        console.log(`${username} (${userId}) joining room ${roomId}`);
        // Verify room exists
        const room = yield prisma.room.findUnique({
          where: { id: roomId },
          include: { admin: true },
        });
        if (!room) {
          return socket.emit("error", "Room not found");
        }
        // Leave previous rooms
        const socketRooms = Array.from(socket.rooms).filter(
          (r) => r !== socket.id
        );
        socketRooms.forEach((room) => socket.leave(room));
        // Join the room
        const roomChannel = `room_${roomId}`;
        socket.join(roomChannel);
        // Create a system message for user joining
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
        // Get recent messages
        const messages = yield prisma.message.findMany({
          where: { roomId },
          orderBy: { createdAt: "asc" },
          take: 50,
          include: { user: true },
        });
        // Send room info and messages to the user
        socket.emit("roomJoined", {
          room,
          messages,
        });
        console.log(`${username} joined ${room.name} successfully`);
      } catch (error) {
        console.error("Error joining room:", error);
        socket.emit("error", "Failed to join room");
      }
    })
  );
  // Handle sending messages
  socket.on("sendMessage", (_a) =>
    __awaiter(
      void 0,
      [_a],
      void 0,
      function* ({ roomId, userId, text, isAdmin }) {
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
            return socket.emit(
              "error",
              "Not authorized to send admin messages"
            );
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
        } catch (error) {
          console.error("Error sending message:", error);
          socket.emit("error", "Failed to send message");
        }
      }
    )
  );
  // Delete a message
  socket.on("deleteMessage", (_a) =>
    __awaiter(void 0, [_a], void 0, function* ({ messageId }) {
      try {
        yield prisma.message.delete({
          where: { id: messageId },
        });
      } catch (error) {
        console.error("Error deleting message:", error);
        socket.emit("error", "Failed to delete message");
      }
    })
  );
  // Delete a room
  socket.on("deleteRoom", (_a) =>
    __awaiter(void 0, [_a], void 0, function* ({ roomId }) {
      try {
        yield prisma.room.delete({
          where: { id: roomId },
        });
      } catch (error) {
        console.error("Error deleting room:", error);
        socket.emit("error", "Failed to delete room");
      }
    })
  );
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
