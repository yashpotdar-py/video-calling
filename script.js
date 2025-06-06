// script.js
// ------------------------------
// Frontend logic (vanilla JS):
// - Lobby (create/join room)
// - WebRTC peer connection
// - HTTP‐polling–based signaling via Vercel KV
// ------------------------------

// ----------
// 1) Globals & DOM References
// ----------

const lobbyDiv = document.getElementById('lobby');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');

const videoChatDiv = document.getElementById('videoChat');
const roomIdDisplay = document.getElementById('roomIdDisplay');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const leaveBtn = document.getElementById('leaveBtn');
const statusDisplay = document.getElementById('status');

// Simple STUN server (Google)
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' }
];

// State variables
let roomId = null;
let clientId = null;        // unique per browser tab
let peerConnection = null;
let localStream = null;
let remoteStream = null;

let peersInRoom = new Set(); // track other peer IDs seen via "join" msgs
let hasSentOffer = false;    // ensure we send exactly one offer if needed

// Polling interval (ms)
const POLL_INTERVAL = 500;

// ----------
// 2) Utility: Generate Random IDs
// ----------

// 8‐character alphanumeric ID
function generateId(length = 8) {
  return Math.random().toString(36).substring(2, 2 + length);
}

// ----------
// 3) Lobby Logic: Create or Join Room
// ----------

createBtn.addEventListener('click', () => {
  roomId = generateId(8);
  joinRoom(roomId);
});

joinBtn.addEventListener('click', () => {
  const val = roomInput.value.trim();
  if (val.length === 8) {
    roomId = val;
    joinRoom(roomId);
  } else {
    alert('Please enter a valid 8‐character Room ID');
  }
});

function joinRoom(id) {
  roomId = id;
  clientId = generateId(6); // unique per browser/tab

  // Show video chat UI
  lobbyDiv.classList.add('hidden');
  videoChatDiv.classList.remove('hidden');
  roomIdDisplay.innerText = roomId;
  statusDisplay.innerText = '🔴 Connecting...';

  initializeMediaAndConnection();
}

// ----------
// 4) Initialize Local Media & RTCPeerConnection
// ----------

async function initializeMediaAndConnection() {
  try {
    // 4.1: Obtain local video + audio
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;

    // 4.2: Create RTCPeerConnection
    peerConnection = new RTCPeerConnection({ iceServers });

    // Add local tracks to the connection
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    // 4.3: Prepare a MediaStream for remote tracks
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    peerConnection.addEventListener('track', (event) => {
      event.streams[0].getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
    });

    // 4.4: Gather ICE candidates and send them
    peerConnection.addEventListener('icecandidate', (event) => {
      if (event.candidate) {
        sendSignal({
          roomId,
          fromPeer: clientId,
          type: 'ice-candidate',
          data: event.candidate
        });
      }
    });

    // 4.5: Connection state changes
    peerConnection.addEventListener('connectionstatechange', () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        statusDisplay.innerText = '🟢 Connected';
        statusDisplay.style.color = '#080';
      } else if (
        state === 'disconnected' ||
        state === 'failed' ||
        state === 'closed'
      ) {
        statusDisplay.innerText = '🔴 Disconnected';
        statusDisplay.style.color = '#b00';
      }
    });

    // 4.6: Announce our presence (join) via signaling
    await sendSignal({
      roomId,
      fromPeer: clientId,
      type: 'join',
      data: null
    });

    // 4.7: Start polling for incoming signals
    startPolling();

  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert(
      '❌ Cannot access camera/microphone. Please allow permissions and reload.'
    );
  }
}

// ----------
// 5) Polling Loop: Fetch & Handle Signals
// ----------

let pollingHandle = null;

function startPolling() {
  pollingHandle = setInterval(async () => {
    try {
      const resp = await fetch(`/api/getSignals?roomId=${roomId}`);
      const json = await resp.json();
      if (!json.signals || json.signals.length === 0) {
        return;
      }
      await handleIncomingSignals(json.signals);
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, POLL_INTERVAL);
}

// Process each envelope in order (most recent first, but order isn't critical)
// Envelope format: { fromPeer, type, data, timestamp }
async function handleIncomingSignals(envelopes) {
  for (const env of envelopes.reverse()) {
    const { fromPeer, type, data } = env;

    if (fromPeer === clientId) {
      // Ignore our own signals
      continue;
    }

    if (type === 'join') {
      // Another peer joined the room
      peersInRoom.add(fromPeer);
      // If exactly two peers in room (ourselves + one other) and we haven't sent an offer yet,
      // decide who sends the offer. We pick lexicographically smaller ID to send the offer.
      if (!hasSentOffer && peersInRoom.size === 1) {
        // There is exactly one otherPeer. Compare IDs.
        const otherPeerId = [...peersInRoom][0];
        if (clientId < otherPeerId) {
          // We are "smaller" → send the offer
          await createAndSendOffer(otherPeerId);
          hasSentOffer = true;
        }
      }
    }

    if (type === 'offer') {
      // Received an SDP offer from the other peer
      const offer = new RTCSessionDescription(data);
      await peerConnection.setRemoteDescription(offer);

      // Create and send an answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      await sendSignal({
        roomId,
        fromPeer: clientId,
        type: 'answer',
        data: answer
      });
      hasSentOffer = true;
    }

    if (type === 'answer') {
      // Received an SDP answer to our offer
      const answerDesc = new RTCSessionDescription(data);
      await peerConnection.setRemoteDescription(answerDesc);
    }

    if (type === 'ice-candidate') {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data));
      } catch (err) {
        console.warn('Error adding received ICE candidate:', err);
      }
    }
  }
}

// ----------
// 6) Create & Send Offer
// ----------

async function createAndSendOffer(otherPeerId) {
  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await sendSignal({
      roomId,
      fromPeer: clientId,
      type: 'offer',
      data: offer
    });
  } catch (err) {
    console.error('Error creating/sending offer:', err);
  }
}

// ----------
// 7) sendSignal(): call the /api/sendSignal endpoint
// ----------

async function sendSignal(message) {
  // message = { roomId, fromPeer, type, data }
  try {
    await fetch('/api/sendSignal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  } catch (err) {
    console.error('sendSignal error:', err);
  }
}

// ----------
// 8) Mute/Unmute & Video On/Off Controls
// ----------

toggleAudioBtn.addEventListener('click', () => {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  audioTrack.enabled = !audioTrack.enabled;
  toggleAudioBtn.innerText = audioTrack.enabled ? 'Mute Audio' : 'Unmute Audio';
});

toggleVideoBtn.addEventListener('click', () => {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  videoTrack.enabled = !videoTrack.enabled;
  toggleVideoBtn.innerText = videoTrack.enabled ? 'Stop Video' : 'Start Video';
});

// ----------
// 9) Leave Room
// ----------

leaveBtn.addEventListener('click', () => {
  // Close RTCPeerConnection
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  // Stop polling
  clearInterval(pollingHandle);
  pollingHandle = null;

  // Reload to go back to lobby
  window.location.href = '/';
});

// ----------
// 10) Deep Linking: If user navigates to /<ROOMID>, auto-join
// ----------

window.addEventListener('load', () => {
  // If path is like "/abcd1234" (8-char alphanumeric), auto‐join
  const path = window.location.pathname.slice(1); // remove leading '/'
  if (path.length === 8 && /^[a-zA-Z0-9]+$/.test(path)) {
    roomId = path;
    joinRoom(roomId);
  }
});
