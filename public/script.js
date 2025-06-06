// script.js
// ------------------------------
// Frontend logic: lobby UI, WebRTC peer connection, signaling via Socket.IO
// ------------------------------

const socket = io(); // connects to the same host that served index.html

// DOM elements
const lobbyDiv = document.getElementById("lobby");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomInput = document.getElementById("roomInput");

const videoChatDiv = document.getElementById("videoChat");
const roomIdDisplay = document.getElementById("roomIdDisplay");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const toggleAudioBtn = document.getElementById("toggleAudioBtn");
const toggleVideoBtn = document.getElementById("toggleVideoBtn");
const leaveBtn = document.getElementById("leaveBtn");
const statusDisplay = document.getElementById("status");

let localStream = null;
let remoteStream = null;
let peerConnection = null;
let roomId = null;
let isAudioMuted = false;
let isVideoOff = false;

// STUN servers configuration
const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  // You can add your TURN server here if needed:
  // { urls: 'turn:YOUR_TURN_SERVER_IP:3478', username: 'user', credential: 'pass' }
];

// ----------------------------------------------------------------
// 1) Lobby Logic: Create or Join a Room
// ----------------------------------------------------------------

// Generate a simple random room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 10);
}

createBtn.addEventListener("click", () => {
  roomId = generateRoomId();
  joinRoom(roomId);
});

joinBtn.addEventListener("click", () => {
  const val = roomInput.value.trim();
  if (val.length > 0) {
    roomId = val;
    joinRoom(roomId);
  } else {
    alert("Please enter a valid Room ID");
  }
});

// Hide lobby, show video chat UI, update room display, then start connection
function joinRoom(id) {
  roomId = id;
  lobbyDiv.classList.add("hidden");
  videoChatDiv.classList.remove("hidden");
  roomIdDisplay.innerText = roomId;
  statusDisplay.innerText = "🔴 Connecting...";

  initMediaAndConnection();
}

// ----------------------------------------------------------------
// 2) Initialize Media and Peer Connection
// ----------------------------------------------------------------

async function initMediaAndConnection() {
  try {
    // 2.1 Get local audio/video
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;

    // 2.2 Create RTCPeerConnection
    peerConnection = new RTCPeerConnection({ iceServers });

    // Add local tracks to peerConnection
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    // 2.3 Handle remote stream
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    peerConnection.addEventListener("track", (event) => {
      // Whenever a remote track is received, add it to remoteStream
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    });

    // 2.4 ICE candidate gathering
    peerConnection.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          targetId: otherPeerId,
          candidate: event.candidate,
        });
      }
    });

    // 2.5 Listen for connection state changes
    peerConnection.addEventListener("connectionstatechange", () => {
      if (peerConnection.connectionState === "connected") {
        statusDisplay.innerText = "🟢 Connected";
      } else if (
        peerConnection.connectionState === "disconnected" ||
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        statusDisplay.innerText = "🔴 Disconnected";
      }
    });

    // 2.6 Now join the room on the signaling server
    socket.emit("join-room", roomId);
  } catch (err) {
    console.error("Error accessing media devices.", err);
    alert(
      "❌ Could not access camera/microphone. Please allow permissions and refresh."
    );
  }
}

// ----------------------------------------------------------------
// 3) Signaling: Exchanging Offers, Answers, ICE Candidates
// ----------------------------------------------------------------

let otherPeerId = null; // to store the ID of the remote peer

// When a new participant joins the room (signaled by server)
socket.on("new-participant", (socketId) => {
  // If we have not yet called the other peer, do it now
  if (!otherPeerId) {
    otherPeerId = socketId;
    createAndSendOffer();
  }
});

// When receiving an offer from another peer
socket.on("offer", async ({ callerId, offer }) => {
  otherPeerId = callerId;
  try {
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // Send the answer back
    socket.emit("answer", {
      targetId: otherPeerId,
      answer: answer,
    });
  } catch (err) {
    console.error("Error handling offer: ", err);
  }
});

// When receiving an answer to our offer
socket.on("answer", async ({ responderId, answer }) => {
  try {
    await peerConnection.setRemoteDescription(answer);
  } catch (err) {
    console.error("Error setting remote description with answer: ", err);
  }
});

// When receiving an ICE candidate from the other peer
socket.on("ice-candidate", async ({ fromId, candidate }) => {
  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (err) {
    console.error("Error adding received ICE candidate", err);
  }
});

// When someone in the room disconnects
socket.on("peer-disconnected", (socketId) => {
  if (socketId === otherPeerId) {
    statusDisplay.innerText = "🔴 Peer Left";
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    otherPeerId = null;
    // Optionally, you could reload or go back to lobby
  }
});

// Create an SDP offer, set local description, and send it via Socket.IO
async function createAndSendOffer() {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", {
      targetId: otherPeerId,
      offer: offer,
    });
  } catch (err) {
    console.error("Error creating or sending offer: ", err);
  }
}

// ----------------------------------------------------------------
// 4) Mute/Unmute & Start/Stop Video
// ----------------------------------------------------------------

toggleAudioBtn.addEventListener("click", () => {
  if (!localStream) return;
  isAudioMuted = !isAudioMuted;
  localStream.getAudioTracks()[0].enabled = !isAudioMuted;
  toggleAudioBtn.innerText = isAudioMuted ? "Unmute Audio" : "Mute Audio";
});

toggleVideoBtn.addEventListener("click", () => {
  if (!localStream) return;
  isVideoOff = !isVideoOff;
  localStream.getVideoTracks()[0].enabled = !isVideoOff;
  toggleVideoBtn.innerText = isVideoOff ? "Start Video" : "Stop Video";
});

// ----------------------------------------------------------------
// 5) Leave Room (simple version: reload page to go back to lobby)
// ----------------------------------------------------------------

leaveBtn.addEventListener("click", () => {
  socket.disconnect();
  window.location.href = "/";
});
