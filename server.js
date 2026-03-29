const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

function getServerURL() {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return `http://${iface.address}:${PORT}`;
    }
  }
  return `http://localhost:${PORT}`;
}

const WORD_REVEAL_TIME = 60;
const DISCUSSION_TIME = 180;

const wordPairs = [
  ["Pizza", "Flatbread"], ["Sushi", "Sashimi"], ["Burger", "Sandwich"],
  ["Ice Cream", "Gelato"], ["Coffee", "Tea"], ["Chocolate", "Brownie"],
  ["Pasta", "Noodles"], ["Tacos", "Burritos"], ["Beer", "Cider"],
  ["Cake", "Pie"], ["Cheese", "Butter"], ["Salad", "Coleslaw"],
  ["Lion", "Tiger"], ["Dolphin", "Shark"], ["Eagle", "Hawk"],
  ["Wolf", "Fox"], ["Elephant", "Rhinoceros"], ["Penguin", "Puffin"],
  ["Rabbit", "Hare"], ["Crocodile", "Alligator"], ["Butterfly", "Moth"],
  ["Beach", "Lake"], ["Hospital", "Clinic"], ["Library", "Bookstore"],
  ["Airport", "Train Station"], ["Castle", "Palace"], ["Hotel", "Hostel"],
  ["School", "University"], ["Church", "Temple"], ["Stadium", "Arena"],
  ["Football", "Rugby"], ["Tennis", "Badminton"], ["Swimming", "Diving"],
  ["Basketball", "Volleyball"], ["Boxing", "Wrestling"], ["Skiing", "Snowboarding"],
  ["Guitar", "Bass Guitar"], ["Piano", "Keyboard"], ["Clock", "Watch"],
  ["Mirror", "Window"], ["Ring", "Bracelet"], ["Hat", "Cap"],
  ["Candle", "Torch"], ["Newspaper", "Magazine"], ["Soap", "Shampoo"],
  ["iPhone", "Android Phone"], ["Laptop", "Tablet"], ["Movie", "TV Show"],
  ["Superman", "Batman"], ["Mountain", "Hill"], ["River", "Stream"],
  ["Forest", "Jungle"], ["Rose", "Tulip"], ["Diamond", "Crystal"],
  ["Subway", "Bus"], ["Bicycle", "Scooter"], ["Jeans", "Trousers"],
  ["Sneakers", "Boots"], ["Backpack", "Handbag"], ["Umbrella", "Raincoat"],
  ["Cat", "Dog"], ["Gold", "Silver"], ["Sun", "Moon"], ["Sword", "Knife"],
  ["Vampire", "Zombie"], ["Wizard", "Witch"], ["Dragon", "Dinosaur"],
];

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function clearRoomTimers(room) {
  if (room.wordRevealTimer) { clearTimeout(room.wordRevealTimer); room.wordRevealTimer = null; }
  if (room.discussionTimer) { clearTimeout(room.discussionTimer); room.discussionTimer = null; }
}

function startRound(room) {
  clearRoomTimers(room);
  room.round++;
  room.state = 'word-reveal';
  room.votes = {};
  room.readyPlayers = new Set();

  const pair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
  room.wordPair = pair;
  room.imposter = room.players[Math.floor(Math.random() * room.players.length)].id;

  const endTime = Date.now() + WORD_REVEAL_TIME * 1000;
  room.wordRevealEndTime = endTime;

  room.wordRevealTimer = setTimeout(() => {
    if (room.state === 'word-reveal') startDiscussion(room);
  }, WORD_REVEAL_TIME * 1000);

  room.players.forEach(player => {
    const isImposter = player.id === room.imposter;
    io.to(player.id).emit('round-started', {
      round: room.round,
      word: isImposter ? pair[1] : pair[0],
      isImposter,
      players: room.players,
      endTime,
      hostId: room.host,
    });
  });
}

function startDiscussion(room) {
  clearRoomTimers(room);
  room.state = 'discussion';
  const endTime = Date.now() + DISCUSSION_TIME * 1000;

  room.discussionTimer = setTimeout(() => {
    if (room.state === 'discussion') startVoting(room);
  }, DISCUSSION_TIME * 1000);

  io.to(room.code).emit('discussion-started', { endTime, players: room.players, hostId: room.host });
}

function startVoting(room) {
  clearRoomTimers(room);
  room.state = 'voting';
  room.votes = {};
  io.to(room.code).emit('voting-started', { players: room.players, hostId: room.host });
}

function resolveVotes(room) {
  room.state = 'results';
  clearRoomTimers(room);

  const voteCounts = {};
  room.players.forEach(p => { voteCounts[p.id] = 0; });
  Object.values(room.votes).forEach(id => { if (id in voteCounts) voteCounts[id]++; });

  const maxVotes = Math.max(...Object.values(voteCounts));
  const leaders = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);
  const imposterCaught = leaders.length === 1 && leaders[0] === room.imposter;

  const imposterPlayer = room.players.find(p => p.id === room.imposter);
  if (imposterCaught) {
    room.players.forEach(p => { if (p.id !== room.imposter) p.score++; });
  } else {
    if (imposterPlayer) imposterPlayer.score += 2;
  }

  io.to(room.code).emit('round-results', {
    imposterId: room.imposter,
    imposterName: imposterPlayer?.name ?? '???',
    civilianWord: room.wordPair[0],
    imposterWord: room.wordPair[1],
    imposterCaught,
    voteCounts,
    players: room.players,
    hostId: room.host,
  });
}

io.on('connection', (socket) => {
  const serverUrl = getServerURL();

  socket.on('create-room', ({ playerName }) => {
    if (!playerName?.trim()) return;
    const code = generateCode();
    const player = { id: socket.id, name: playerName.trim(), score: 0 };
    const room = {
      code, host: socket.id,
      players: [player],
      state: 'lobby',
      round: 0, wordPair: null, imposter: null,
      votes: {}, readyPlayers: new Set(),
      wordRevealTimer: null, discussionTimer: null,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.emit('room-created', { code, player, serverUrl });
  });

  socket.on('join-room', ({ code, playerName }) => {
    if (!playerName?.trim() || !code?.trim()) return;
    const room = rooms.get(code.trim().toUpperCase());
    if (!room) { socket.emit('join-error', 'Room not found. Check the code and try again.'); return; }
    if (room.state !== 'lobby') { socket.emit('join-error', 'Game already in progress.'); return; }
    if (room.players.length >= 12) { socket.emit('join-error', 'Room is full (max 12 players).'); return; }
    if (room.players.some(p => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
      socket.emit('join-error', 'That name is taken. Choose a different one.'); return;
    }
    const player = { id: socket.id, name: playerName.trim(), score: 0 };
    room.players.push(player);
    socket.join(room.code);
    socket.emit('joined-room', { code: room.code, player, players: room.players, hostId: room.host, serverUrl });
    socket.to(room.code).emit('player-joined', { players: room.players, newPlayer: player });
  });

  socket.on('start-game', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'lobby') return;
    if (room.players.length < 3) { socket.emit('game-error', 'Need at least 3 players to start!'); return; }
    startRound(room);
  });

  socket.on('player-ready', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'word-reveal') return;
    room.readyPlayers.add(socket.id);
    io.to(code).emit('ready-update', { readyCount: room.readyPlayers.size, totalPlayers: room.players.length });
    if (room.readyPlayers.size >= room.players.length) startDiscussion(room);
  });

  socket.on('force-discussion', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'word-reveal') return;
    startDiscussion(room);
  });

  socket.on('force-voting', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'discussion') return;
    startVoting(room);
  });

  socket.on('cast-vote', ({ code, votedForId }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'voting' || room.votes[socket.id]) return;
    room.votes[socket.id] = votedForId;
    io.to(code).emit('vote-update', {
      voteCount: Object.keys(room.votes).length,
      totalPlayers: room.players.length,
    });
    if (Object.keys(room.votes).length >= room.players.length) resolveVotes(room);
  });

  socket.on('next-round', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id || room.state !== 'results') return;
    startRound(room);
  });

  socket.on('back-to-lobby', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.host !== socket.id) return;
    clearRoomTimers(room);
    room.state = 'lobby';
    room.round = 0;
    room.players.forEach(p => { p.score = 0; });
    io.to(code).emit('back-to-lobby', { players: room.players, hostId: room.host });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;
      const [player] = room.players.splice(idx, 1);

      if (room.players.length === 0) {
        clearRoomTimers(room);
        rooms.delete(code);
        break;
      }

      let newHostId = null;
      if (room.host === socket.id) {
        room.host = room.players[0].id;
        newHostId = room.host;
      }

      io.to(code).emit('player-left', { players: room.players, playerName: player.name, newHostId });

      if (room.state === 'voting' && Object.keys(room.votes).length >= room.players.length) {
        resolveVotes(room);
      }
      if (room.state === 'word-reveal' && room.readyPlayers.size >= room.players.length && room.players.length > 0) {
        startDiscussion(room);
      }
      break;
    }
  });
});

server.listen(PORT, () => {
  console.log(`\nImposter Game Server`);
  console.log(`  URL: ${getServerURL()}\n`);
});
