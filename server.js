const express = require("express");
require("dotenv").config();
const { createServer } = require("node:http");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;

const prisma = new PrismaClient();
const app = express();
const server = createServer(app);

const ADMIN_PASSWORD = "123456";

app.use(
  cors({
    origin: [
      "https://chat-frontend-ten-opal.vercel.app",
      "http://localhost:3000",
      "https://chat-frontend-d7kr2bgv3-babaj301s-projects.vercel.app",
      "http://127.0.0.1:3000", // Add this line
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

cloudinary.config({
  cloud_name: "dsblurb7p",
  api_key: "834265428478147",
  api_secret: "nShVL7aKA_bDsls6omSE-XkLtQU",
});

// Set up multer for memory storage
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

const io = new Server(server, {
  cors: {
    origin: [
      "https://chat-frontend-ten-opal.vercel.app",
      "http://localhost:3000",
      "https://chat-frontend-d7kr2bgv3-babaj301s-projects.vercel.app",
      "http://127.0.0.1:3000", // Add this line
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});
app.use(express.json());

// Basic route
app.get("/", (req, res) => {
  res.send("Chat API is running");
});

// Get all chat rooms
app.get("/rooms", async (req, res) => {
  console.log("Fetching rooms");
  try {
    const rooms = await prisma.room.findMany({
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
});

// Create a room
app.post("/rooms", async (req, res) => {
  try {
    const { name, adminId } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Room name is required" });
    }

    const newRoom = await prisma.room.create({
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
});

// Create or get a user with admin authentication
app.post("/users", async (req, res) => {
  try {
    const { name, isAdmin, adminPassword } = req.body;

    if (!name) {
      return res.status(400).json({ error: "User name is required" });
    }

    // If requesting admin privileges, verify password
    if (isAdmin && adminPassword !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid admin password" });
    }

    let user = await prisma.user.findUnique({
      where: { name },
    });

    if (user) {
      // If user exists and is requesting admin, update their status
      if (isAdmin && adminPassword === ADMIN_PASSWORD && !user.isAdmin) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { isAdmin: true },
        });
        console.log(`User ${name} upgraded to admin status`);
      }
    } else {
      // Create new user with appropriate admin status
      user = await prisma.user.create({
        data: {
          name,
          isAdmin: isAdmin && adminPassword === ADMIN_PASSWORD,
        },
      });
      console.log(`Created new user: ${name}${user.isAdmin ? " (admin)" : ""}`);
    }

    res.json(user);
  } catch (error) {
    console.error("Error with user:", error);
    res.status(500).json({ error: "Failed to process user" });
  }
});

// Upload image endpoint
app.post("/upload", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: "chat-app" },
        (error, result) => {
          if (error) reject(new Error(error));
          else resolve(result);
        }
      );

      uploadStream.end(req.file.buffer);
    });

    res.json({ imageUrl: result.secure_url });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// Update the audio upload endpoint
app.post("/upload-audio", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    // Upload to Cloudinary using buffer like we do with images
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "video",
          folder: "chat-audio",
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );

      uploadStream.end(req.file.buffer);
    });

    res.json({ audioUrl: result.secure_url });
  } catch (error) {
    console.error("Error uploading audio:", error);
    res.status(500).json({ error: "Failed to upload audio" });
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle room creation
  socket.on("createRoom", async ({ name, adminId }) => {
    try {
      const newRoom = await prisma.room.create({
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
  });

  // Handle joining a room
  socket.on("joinRoom", async ({ roomId, userId, username }) => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        include: { admin: true },
      });

      if (!room) {
        return socket.emit("error", "Room not found");
      }

      const roomChannel = `room_${roomId}`;
      socket.join(roomChannel);

      // Get existing system message for this user
      const existingJoinMessage = await prisma.message.findFirst({
        where: {
          roomId,
          text: `${username} has joined the room`,
          isSystem: true,
        },
      });

      // Only create join message if user hasn't joined before
      if (!existingJoinMessage) {
        const systemMessage = await prisma.message.create({
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
      } // Get recent messages
      const messages = await prisma.message.findMany({
        where: {
          roomId,
          parentId: null, // Only get top-level messages
        },
        orderBy: { createdAt: "asc" },
        take: 50,
        include: {
          user: true,
          replies: {
            select: {
              id: true, // Just to get the count
            },
          },
        },
      });

      // Send room info and messages to the user
      socket.emit("roomJoined", { room, messages });
    } catch (error) {
      console.error("Error joining room:", error);
      socket.emit("error", "Failed to join room");
    }
  });

  // Handle sending messages
  socket.on(
    "sendMessage",
    async ({ roomId, userId, text, imageUrl, isAdmin }) => {
      try {
        if (!roomId || !userId || (!text && !imageUrl)) {
          return socket.emit("error", "Missing required message data");
        }

        // Verify user exists
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          return socket.emit("error", "User not found");
        }

        // Verify room exists
        const room = await prisma.room.findUnique({
          where: { id: roomId },
        });

        if (!room) {
          return socket.emit("error", "Room not found");
        }

        // For admin messages, verify the user is an admin
        if (isAdmin && !user.isAdmin && room.adminId !== userId) {
          return socket.emit("error", "Not authorized to send admin messages");
        }

        // Save message to database with explicit room relation
        const newMessage = await prisma.message.create({
          data: {
            text,
            imageUrl,
            userId,
            roomId,
            isAdmin: isAdmin && (user.isAdmin || room.adminId === userId),
          },
          include: {
            user: true,
            room: true,
          },
        });

        // Broadcast to everyone in the room
        io.to(`room_${roomId}`).emit("newMessage", newMessage);
      } catch (error) {
        console.error("Error sending message:", error);
        socket.emit("error", "Failed to send message");
      }
    }
  );

  // Handle thread replies
  socket.on(
    "sendThreadReply",
    async ({ roomId, userId, parentId, text, imageUrl, isAdmin }) => {
      try {
        if (!roomId || !userId || !parentId || (!text && !imageUrl)) {
          return socket.emit("error", "Missing required thread reply data");
        }

        // Verify parent message exists
        const parentMessage = await prisma.message.findUnique({
          where: { id: parentId },
        });

        if (!parentMessage) {
          return socket.emit("error", "Parent message not found");
        }

        // Verify user exists
        const user = await prisma.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          return socket.emit("error", "User not found");
        }

        // Create the reply message
        const newReply = await prisma.message.create({
          data: {
            text,
            imageUrl,
            userId,
            roomId,
            parentId,
            isAdmin: isAdmin && user.isAdmin,
          },
          include: {
            user: true,
            room: true,
          },
        });

        // Update thread count on parent message
        await prisma.message.update({
          where: { id: parentId },
          data: {
            threadCount: {
              increment: 1,
            },
          },
        });

        // Broadcast to everyone in the room
        io.to(`room_${roomId}`).emit("newThreadReply", {
          parentId,
          reply: newReply,
        });
      } catch (error) {
        console.error("Error sending thread reply:", error);
        socket.emit("error", "Failed to send thread reply");
      }
    }
  );

  // Get thread messages
  socket.on("getThreadMessages", async ({ parentId }) => {
    try {
      const threadMessages = await prisma.message.findMany({
        where: {
          parentId,
        },
        orderBy: {
          createdAt: "asc",
        },
        include: {
          user: true,
        },
      });

      socket.emit("threadMessages", {
        parentId,
        messages: threadMessages,
      });
    } catch (error) {
      console.error("Error getting thread messages:", error);
      socket.emit("error", "Failed to get thread messages");
    }
  });

  // Handle deleting thread messages
  socket.on("deleteThreadMessage", async ({ messageId, userId }) => {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { room: true },
      });

      if (!message) {
        return socket.emit("error", "Message not found");
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      // Check if user is authorized to delete this message
      if (
        message.userId !== userId &&
        message.room.adminId !== userId &&
        !user.isAdmin
      ) {
        return socket.emit("error", "Not authorized to delete this message");
      }

      // If this is a thread reply, decrement parent's thread count
      if (message.parentId) {
        await prisma.message.update({
          where: { id: message.parentId },
          data: {
            threadCount: {
              decrement: 1,
            },
          },
        });
      }

      await prisma.message.delete({
        where: { id: messageId },
      });

      // Broadcast to room that message was deleted
      io.to(`room_${message.roomId}`).emit("threadMessageDeleted", {
        messageId,
        parentId: message.parentId,
      });
    } catch (error) {
      console.error("Error deleting thread message:", error);
      socket.emit("error", "Failed to delete thread message");
    }
  });

  // Delete a message
  socket.on("deleteMessage", async ({ messageId, userId }) => {
    try {
      // Find the message first to check permissions
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { room: true },
      });

      if (!message) {
        return socket.emit("error", "Message not found");
      }

      // Get user info
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      // Check if user is authorized to delete this message
      // Only message author, room admin, or system admin can delete messages
      if (
        message.userId !== userId &&
        message.room.adminId !== userId &&
        !user.isAdmin
      ) {
        return socket.emit("error", "Not authorized to delete this message");
      }

      await prisma.message.delete({
        where: { id: messageId },
      });

      // Broadcast to room that message was deleted
      io.to(`room_${message.roomId}`).emit("messageDeleted", { messageId });
    } catch (error) {
      console.error("Error deleting message:", error);
      socket.emit("error", "Failed to delete message");
    }
  });

  // Handle user typing

  socket.on("typing", ({ roomId, username, isTyping }) => {
    // Broadcast to everyone in the room except the sender
    socket.to(`room_${roomId}`).emit("userTyping", {
      roomId,
      username,
      isTyping,
    });
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;

// Initialize rooms before starting the server
server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
