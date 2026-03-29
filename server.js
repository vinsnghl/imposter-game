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

// { category, word } — imposter gets the category, civilians get the word
const wordList = [
  // Food & Drink
  { category: "Italian Food", word: "Pizza" },
  { category: "Japanese Food", word: "Sushi" },
  { category: "Fast Food", word: "Burger" },
  { category: "Frozen Dessert", word: "Ice Cream" },
  { category: "Hot Drink", word: "Coffee" },
  { category: "Sweet Treat", word: "Chocolate" },
  { category: "Pasta Dish", word: "Spaghetti" },
  { category: "Mexican Food", word: "Tacos" },
  { category: "Baked Good", word: "Croissant" },
  { category: "Breakfast Food", word: "Pancakes" },
  { category: "Seafood", word: "Lobster" },
  { category: "Street Food", word: "Hot Dog" },
  { category: "Alcoholic Drink", word: "Whiskey" },
  { category: "Fruit", word: "Watermelon" },
  { category: "Vegetable", word: "Broccoli" },
  { category: "Spice", word: "Cinnamon" },
  { category: "Cheese", word: "Mozzarella" },
  { category: "Dessert", word: "Cheesecake" },
  // Animals
  { category: "Big Cat", word: "Lion" },
  { category: "Sea Creature", word: "Dolphin" },
  { category: "Bird of Prey", word: "Eagle" },
  { category: "Wild Dog", word: "Wolf" },
  { category: "Large Mammal", word: "Elephant" },
  { category: "Flightless Bird", word: "Penguin" },
  { category: "Small Mammal", word: "Rabbit" },
  { category: "Reptile", word: "Crocodile" },
  { category: "Insect", word: "Butterfly" },
  { category: "Farm Animal", word: "Cow" },
  { category: "Primate", word: "Gorilla" },
  { category: "Ocean Fish", word: "Shark" },
  { category: "Rodent", word: "Squirrel" },
  { category: "Mythical Creature", word: "Dragon" },
  // Places
  { category: "Vacation Spot", word: "Beach" },
  { category: "Medical Building", word: "Hospital" },
  { category: "Knowledge Building", word: "Library" },
  { category: "Transport Hub", word: "Airport" },
  { category: "Historic Building", word: "Castle" },
  { category: "Accommodation", word: "Hotel" },
  { category: "Education Building", word: "School" },
  { category: "Worship Building", word: "Church" },
  { category: "Sports Venue", word: "Stadium" },
  { category: "Shopping Place", word: "Mall" },
  { category: "Outdoor Area", word: "Park" },
  { category: "Entertainment Venue", word: "Casino" },
  { category: "Government Building", word: "Courthouse" },
  { category: "Natural Landmark", word: "Waterfall" },
  // Sports
  { category: "Team Sport", word: "Football" },
  { category: "Racket Sport", word: "Tennis" },
  { category: "Water Sport", word: "Swimming" },
  { category: "Court Sport", word: "Basketball" },
  { category: "Combat Sport", word: "Boxing" },
  { category: "Winter Sport", word: "Skiing" },
  { category: "Bat and Ball Sport", word: "Baseball" },
  { category: "Martial Art", word: "Karate" },
  { category: "Track Event", word: "Marathon" },
  { category: "Extreme Sport", word: "Surfing" },
  // Objects & Tech
  { category: "String Instrument", word: "Guitar" },
  { category: "Keyboard Instrument", word: "Piano" },
  { category: "Timekeeping Device", word: "Clock" },
  { category: "Jewelry", word: "Diamond Ring" },
  { category: "Headwear", word: "Hat" },
  { category: "Light Source", word: "Candle" },
  { category: "Smartphone", word: "iPhone" },
  { category: "Computer", word: "Laptop" },
  { category: "Weapon", word: "Sword" },
  { category: "Vehicle", word: "Motorcycle" },
  { category: "Currency", word: "Gold Coin" },
  { category: "Musical Instrument", word: "Drums" },
  { category: "Footwear", word: "Sneakers" },
  { category: "Bag", word: "Backpack" },
  { category: "Outerwear", word: "Raincoat" },
  // Pop Culture
  { category: "Superhero", word: "Superman" },
  { category: "Movie Genre", word: "Horror Film" },
  { category: "Social Media App", word: "Instagram" },
  { category: "Streaming Service", word: "Netflix" },
  { category: "Video Game Console", word: "PlayStation" },
  { category: "Fictional Monster", word: "Vampire" },
  { category: "Fantasy Character", word: "Wizard" },
  { category: "Card Game", word: "Poker" },
  { category: "Board Game", word: "Chess" },
  { category: "Dance Style", word: "Hip Hop" },
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

  const entry = wordList[Math.floor(Math.random() * wordList.length)];
  room.wordPair = entry;
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
      category: entry.category,
      word: isImposter ? null : entry.word,
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
    category: room.wordPair.category,
    word: room.wordPair.word,
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
