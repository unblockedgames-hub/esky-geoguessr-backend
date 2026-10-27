const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// ============================================================================
// MAPILLARY API TOKEN CONFIGURATION
// Set this via MAPILLARY_TOKEN in Render environment variables or .env file,
// or paste your token directly into the fallback below.
// ============================================================================
const MAPILLARY_TOKEN = process.env.MAPILLARY_TOKEN || "";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Health check for Render
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// Provide client token securely to frontend
app.get('/api/config', (req, res) => {
  res.json({
    hasToken: Boolean(MAPILLARY_TOKEN && MAPILLARY_TOKEN.trim().length > 5),
    token: MAPILLARY_TOKEN || ""
  });
});

// Escanaba Bounding Box
const ESCANABA_BBOX = {
  minLon: -87.1000,
  minLat: 45.7200,
  maxLon: -87.0400,
  maxLat: 45.7800
};

// Curated Fallback Spots
const DEMO_LOCATIONS = [
  { name: "Ludington Park Gazebo & Bay View", lat: 45.7431, lng: -87.0498, image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80" },
  { name: "Escanaba Municipal Marina & Harbor", lat: 45.7485, lng: -87.0448, image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=1600&q=80" },
  { name: "Downtown Ludington Street & 10th St", lat: 45.7460, lng: -87.0615, image: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=1600&q=80" },
  { name: "Delta County Courthouse (310 Ludington)", lat: 45.7461, lng: -87.0534, image: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1600&q=80" },
  { name: "Lincoln Road Commercial Strip (US-2/41)", lat: 45.7505, lng: -87.0862, image: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=1600&q=80" },
  { name: "Upper Peninsula State Fairgrounds Entrance", lat: 45.7592, lng: -87.0820, image: "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?auto=format&fit=crop&w=1600&q=80" },
  { name: "Escanaba High School (South Lincoln)", lat: 45.7360, lng: -87.0870, image: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1600&q=80" },
  { name: "North Shore Rivermouth & Bay View", lat: 45.7725, lng: -87.0630, image: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1600&q=80" }
];

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getRandomEscanabaCoord() {
  const lat = ESCANABA_BBOX.minLat + Math.random() * (ESCANABA_BBOX.maxLat - ESCANABA_BBOX.minLat);
  const lng = ESCANABA_BBOX.minLon + Math.random() * (ESCANABA_BBOX.maxLon - ESCANABA_BBOX.minLon);
  return { lat, lng };
}

async function findNearestMapillaryImage(coord, token, delta = 0.0045) {
  const minX = (coord.lng - delta).toFixed(5);
  const minY = (coord.lat - delta).toFixed(5);
  const maxX = (coord.lng + delta).toFixed(5);
  const maxY = (coord.lat + delta).toFixed(5);

  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,geometry,sequence&bbox=${minX},${minY},${maxX},${maxY}&limit=6`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.data && data.data.length > 0) {
      const sorted = data.data.sort((a, b) => {
        const distA = calculateHaversineDistance(coord.lat, coord.lng, a.geometry.coordinates[1], a.geometry.coordinates[0]);
        const distB = calculateHaversineDistance(coord.lat, coord.lng, b.geometry.coordinates[1], b.geometry.coordinates[0]);
        return distA - distB;
      });
      return sorted[0];
    }
  } catch (err) {
    console.error("Mapillary lookup error:", err.message);
  }
  return null;
}

async function generateGameRounds(count = 5) {
  if (MAPILLARY_TOKEN && MAPILLARY_TOKEN.trim().length > 5) {
    try {
      const pool = [];
      const seenIds = new Set();
      let attempts = 0;
      const maxAttempts = 35;

      while (pool.length < count && attempts < maxAttempts) {
        attempts += 5;
        const coords = Array.from({ length: 5 }, () => getRandomEscanabaCoord());
        const results = await Promise.all(coords.map(c => findNearestMapillaryImage(c, MAPILLARY_TOKEN)));

        for (const item of results) {
          if (!item || seenIds.has(item.id)) continue;
          const lat = item.geometry.coordinates[1];
          const lng = item.geometry.coordinates[0];

          const isFarEnough = pool.every(p => calculateHaversineDistance(lat, lng, p.lat, p.lng) >= 180);
          if (!isFarEnough) continue;

          seenIds.add(item.id);
          pool.push({
            id: item.id,
            isDemo: false,
            lat,
            lng,
            name: `Escanaba Spot #${pool.length + 1}`
          });

          if (pool.length === count) break;
        }
      }

      if (pool.length >= count) {
        return pool;
      }
    } catch (e) {
      console.warn("Falling back to demo locations:", e.message);
    }
  }

  const shuffled = [...DEMO_LOCATIONS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).map((item, idx) => ({
    ...item,
    id: `demo_${idx}`,
    isDemo: true
  }));
}

function calculateScore(distMeters) {
  return Math.max(0, Math.round(5000 * Math.exp(-distMeters / 500)));
}

// ============================================================================
// ROOMS & MULTIPLAYER STATE
// ============================================================================
const rooms = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function getRoomsListSummary() {
  const list = [];
  for (const [id, room] of rooms.entries()) {
    list.push({
      id: room.id,
      name: room.name,
      hasPasscode: Boolean(room.passcode && room.passcode.trim().length > 0),
      hostUsername: room.players[room.hostId]?.username || 'Host',
      playerCount: Object.keys(room.players).length,
      maxPlayers: room.maxPlayers,
      gamesCount: room.gamesCount,
      roundsPerGame: room.roundsPerGame,
      currentGameIndex: room.currentGameIndex,
      currentRoundIndex: room.currentRoundIndex,
      status: room.status,
      playerNames: Object.values(room.players).map(p => p.username)
    });
  }
  return list;
}

io.on('connection', (socket) => {
  let currentRoomId = null;

  socket.on('get_rooms', () => {
    socket.emit('rooms_list', getRoomsListSummary());
  });

  // Create Room with Games Count and Rounds per Game (1 guess per round fixed)
  socket.on('create_room', async ({ username, roomName, passcode, maxPlayers, gamesCount, roundsPerGame }) => {
    const roomId = generateRoomId();
    currentRoomId = roomId;

    const newRoom = {
      id: roomId,
      name: roomName.trim() || `Room ${roomId}`,
      passcode: passcode ? passcode.trim() : '',
      hostId: socket.id,
      maxPlayers: Math.max(2, Math.min(20, parseInt(maxPlayers) || 8)),
      gamesCount: Math.max(1, Math.min(10, parseInt(gamesCount) || 1)),
      roundsPerGame: Math.max(1, Math.min(15, parseInt(roundsPerGame) || 5)),
      guessesPerRound: 1, // Fixed: 1 guess per round
      currentGameIndex: 1,
      currentRoundIndex: 0,
      status: 'lobby',
      roundsData: [],
      players: {
        [socket.id]: {
          id: socket.id,
          username: username.trim() || 'Player',
          isHost: true,
          roundScore: 0,
          gameScore: 0,
          totalScore: 0,
          gamesWon: 0,
          guesses: [],
          hasSubmitted: false
        }
      }
    };

    rooms.set(roomId, newRoom);
    socket.join(roomId);

    socket.emit('room_created', {
      roomId,
      room: {
        id: newRoom.id,
        name: newRoom.name,
        hasPasscode: Boolean(newRoom.passcode),
        isHost: true,
        hostId: socket.id,
        maxPlayers: newRoom.maxPlayers,
        gamesCount: newRoom.gamesCount,
        roundsPerGame: newRoom.roundsPerGame,
        status: newRoom.status,
        players: Object.values(newRoom.players)
      }
    });

    io.emit('rooms_list', getRoomsListSummary());
  });

  // Join Room
  socket.on('join_room', ({ username, roomId, passcode }) => {
    const room = rooms.get(roomId);
    if (!room) {
      return socket.emit('join_error', 'Room not found.');
    }

    if (room.status !== 'lobby') {
      return socket.emit('join_error', 'This match has already started.');
    }

    if (Object.keys(room.players).length >= room.maxPlayers) {
      return socket.emit('join_error', 'Room is full.');
    }

    if (room.passcode && room.passcode !== (passcode || '').trim()) {
      return socket.emit('join_error', 'Incorrect passcode.');
    }

    currentRoomId = roomId;
    socket.join(roomId);

    room.players[socket.id] = {
      id: socket.id,
      username: username.trim() || `Player ${Object.keys(room.players).length + 1}`,
      isHost: false,
      roundScore: 0,
      gameScore: 0,
      totalScore: 0,
      gamesWon: 0,
      guesses: [],
      hasSubmitted: false
    };

    socket.emit('room_joined', {
      roomId,
      room: {
        id: room.id,
        name: room.name,
        hasPasscode: Boolean(room.passcode),
        isHost: false,
        hostId: room.hostId,
        maxPlayers: room.maxPlayers,
        gamesCount: room.gamesCount,
        roundsPerGame: room.roundsPerGame,
        status: room.status,
        players: Object.values(room.players)
      }
    });

    io.to(roomId).emit('room_update', {
      players: Object.values(room.players),
      hostId: room.hostId
    });

    io.emit('rooms_list', getRoomsListSummary());
  });

  // Start Match / Game (Host Only)
  socket.on('start_game', async () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;

    io.to(room.id).emit('game_loading', `Starting Game 1 of ${room.gamesCount}... Generating locations...`);

    room.currentGameIndex = 1;
    room.currentRoundIndex = 0;
    room.roundsData = await generateGameRounds(room.roundsPerGame);
    room.status = 'playing';

    // Reset all match stats
    for (const player of Object.values(room.players)) {
      player.roundScore = 0;
      player.gameScore = 0;
      player.totalScore = 0;
      player.gamesWon = 0;
      player.guesses = [];
      player.hasSubmitted = false;
    }

    io.emit('rooms_list', getRoomsListSummary());
    startNextRound(room);
  });

  function startNextRound(room) {
    room.currentRoundIndex++;
    room.status = 'playing';

    const currentTarget = room.roundsData[room.currentRoundIndex - 1];

    for (const player of Object.values(room.players)) {
      player.roundScore = 0;
      player.guesses = [];
      player.hasSubmitted = false;
    }

    io.to(room.id).emit('round_start', {
      currentGame: room.currentGameIndex,
      totalGames: room.gamesCount,
      roundIndex: room.currentRoundIndex,
      roundsPerGame: room.roundsPerGame,
      target: {
        id: currentTarget.id,
        isDemo: currentTarget.isDemo,
        image: currentTarget.image || null
      },
      players: Object.values(room.players).map(p => ({
        id: p.id,
        username: p.username,
        gameScore: p.gameScore,
        totalScore: p.totalScore,
        hasSubmitted: p.hasSubmitted
      }))
    });
  }

  // Submit Guess (1 guess per round strictly)
  socket.on('submit_guess', ({ lat, lng }) => {
    const room = rooms.get(currentRoomId);
    if (!room || room.status !== 'playing') return;

    const player = room.players[socket.id];
    if (!player || player.hasSubmitted) return;

    const currentTarget = room.roundsData[room.currentRoundIndex - 1];
    const distMeters = calculateHaversineDistance(lat, lng, currentTarget.lat, currentTarget.lng);
    const score = calculateScore(distMeters);

    player.hasSubmitted = true;
    player.roundScore = score;
    player.gameScore += score;
    player.totalScore += score;
    player.guesses = [{ lat, lng, distMeters, score }];

    io.to(room.id).emit('player_guess_progress', {
      playerId: player.id,
      username: player.username,
      hasSubmitted: true,
      totalPlayers: Object.keys(room.players).length,
      submittedCount: Object.values(room.players).filter(p => p.hasSubmitted).length
    });

    // Check if everyone is done
    const allDone = Object.values(room.players).every(p => p.hasSubmitted);
    if (allDone) {
      endRound(room);
    }
  });

  function endRound(room) {
    room.status = 'round_result';
    const currentTarget = room.roundsData[room.currentRoundIndex - 1];
    const isGameEnd = room.currentRoundIndex >= room.roundsPerGame;
    const isSeriesEnd = isGameEnd && (room.currentGameIndex >= room.gamesCount);

    // If game ended, determine winner of this game
    let gameWinner = null;
    if (isGameEnd) {
      const sortedByGame = Object.values(room.players).sort((a, b) => b.gameScore - a.gameScore);
      if (sortedByGame.length > 0) {
        sortedByGame[0].gamesWon++;
        gameWinner = sortedByGame[0].username;
      }
    }

    const leaderboard = Object.values(room.players)
      .map(p => ({
        id: p.id,
        username: p.username,
        roundScore: p.roundScore,
        gameScore: p.gameScore,
        totalScore: p.totalScore,
        gamesWon: p.gamesWon,
        bestGuess: p.guesses[0] || null
      }))
      .sort((a, b) => b.gameScore - a.gameScore);

    io.to(room.id).emit('round_ended', {
      currentGame: room.currentGameIndex,
      totalGames: room.gamesCount,
      roundIndex: room.currentRoundIndex,
      roundsPerGame: room.roundsPerGame,
      targetLocation: {
        lat: currentTarget.lat,
        lng: currentTarget.lng,
        name: currentTarget.name
      },
      leaderboard,
      isGameEnd,
      isSeriesEnd,
      gameWinner
    });
  }

  // Next Round / Next Game (Host Only)
  socket.on('next_round', async () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id || room.status !== 'round_result') return;

    if (room.currentRoundIndex < room.roundsPerGame) {
      // Continue next round in the current game
      startNextRound(room);
    } else if (room.currentGameIndex < room.gamesCount) {
      // Start Next Game in the Series
      room.currentGameIndex++;
      room.currentRoundIndex = 0;
      io.to(room.id).emit('game_loading', `Loading Game ${room.currentGameIndex} of ${room.gamesCount}...`);

      room.roundsData = await generateGameRounds(room.roundsPerGame);
      for (const player of Object.values(room.players)) {
        player.gameScore = 0;
        player.roundScore = 0;
        player.guesses = [];
        player.hasSubmitted = false;
      }
      startNextRound(room);
    } else {
      // Series Over -> Final Match Results
      room.status = 'game_over';
      const finalLeaderboard = Object.values(room.players)
        .map(p => ({
          id: p.id,
          username: p.username,
          totalScore: p.totalScore,
          gamesWon: p.gamesWon
        }))
        .sort((a, b) => b.totalScore - a.totalScore);

      io.to(room.id).emit('game_over', {
        leaderboard: finalLeaderboard,
        totalGames: room.gamesCount
      });
      io.emit('rooms_list', getRoomsListSummary());
    }
  });

  // Play Again (Reset Room to Lobby)
  socket.on('play_again', () => {
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;

    room.status = 'lobby';
    room.currentGameIndex = 1;
    room.currentRoundIndex = 0;
    room.roundsData = [];

    for (const player of Object.values(room.players)) {
      player.roundScore = 0;
      player.gameScore = 0;
      player.totalScore = 0;
      player.gamesWon = 0;
      player.guesses = [];
      player.hasSubmitted = false;
    }

    io.to(room.id).emit('room_reset_to_lobby', {
      players: Object.values(room.players)
    });

    io.emit('rooms_list', getRoomsListSummary());
  });

  // Disconnect & Leave
  function handleDisconnect() {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    delete room.players[socket.id];
    const remainingCount = Object.keys(room.players).length;

    if (remainingCount === 0) {
      rooms.delete(currentRoomId);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = Object.keys(room.players)[0];
        room.players[room.hostId].isHost = true;
      }

      io.to(room.id).emit('room_update', {
        players: Object.values(room.players),
        hostId: room.hostId
      });

      if (room.status === 'playing') {
        const allDone = Object.values(room.players).every(p => p.hasSubmitted);
        if (allDone) {
          endRound(room);
        }
      }
    }

    io.emit('rooms_list', getRoomsListSummary());
  }

  socket.on('leave_room', handleDisconnect);
  socket.on('disconnect', handleDisconnect);
});

// ============================================================================
// RENDER KEEPALIVE ENGINE
// Render free web services sleep after 15 minutes of inactivity.
// This automatically self-pings the /health endpoint every 13 minutes using
// Render's auto-injected RENDER_EXTERNAL_URL environment variable to stay awake.
// ============================================================================
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL || "";

function startRenderKeepAlive() {
  if (!RENDER_EXTERNAL_URL) {
    console.log("ℹ️ Keepalive idle: Running locally or RENDER_EXTERNAL_URL not set (auto-activates when deployed on Render).");
    return;
  }

  const pingUrl = `${RENDER_EXTERNAL_URL.replace(/\/+$/, '')}/health`;
  const PING_INTERVAL = 13 * 60 * 1000; // 13 minutes (Render timeout is 15 minutes)

  console.log(`⏱️ Keepalive active: Self-pinging ${pingUrl} every 13 minutes to prevent Render spin-down.`);

  setInterval(async () => {
    try {
      const res = await fetch(pingUrl);
      console.log(`💓 [Keepalive] Self-ping status: ${res.status} at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      console.warn(`⚠️ [Keepalive warning]:`, err.message);
    }
  }, PING_INTERVAL);
}

server.listen(PORT, () => {
  console.log(`🌲 Escanaba Guessr Server running on port ${PORT}`);
  console.log(`🔑 Mapillary Token loaded: ${MAPILLARY_TOKEN ? 'YES' : 'NO (Demo fallback active)'}`);
  startRenderKeepAlive();
});
