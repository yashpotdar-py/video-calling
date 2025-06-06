// server.js
// ------------------------------
// Node.js + Express + Socket.IO signaling server
// ------------------------------

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve everything inside /public as static files
app.use(express.static("public"));

// Always serve index.html for any route (so that
// we can use client-side routing via window.location.pathname)
app.get("*", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

io.on("connection", (socket) => {
  console.log("⚡️ New client connected:", socket.id);

  // Join a room
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    console.log(`✅ ${socket.id} joined room ${roomId}`);

    // Notify existing members in this room
    socket.to(roomId).emit("new-participant", socket.id);

    // When we receive an offer from a peer, forward it to the target
    socket.on("offer", ({ targetId, offer }) => {
      io.to(targetId).emit("offer", {
        callerId: socket.id,
        offer: offer,
      });
    });

    // When we receive an answer from a peer, forward it to the original caller
    socket.on("answer", ({ targetId, answer }) => {
      io.to(targetId).emit("answer", {
        responderId: socket.id,
        answer: answer,
      });
    });

    // ICE candidates from a peer → forward to the target
    socket.on("ice-candidate", ({ targetId, candidate }) => {
      io.to(targetId).emit("ice-candidate", {
        fromId: socket.id,
        candidate: candidate,
      });
    });

    // Handle disconnect: notify others in room that this client left
    socket.on("disconnect", () => {
      console.log(`❌ ${socket.id} disconnected`);
      socket.to(roomId).emit("peer-disconnected", socket.id);
    });
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
