const socket = io();

const state = {
  myId: null,
  myName: '',
  roomCode: '',
  isHost: false,
  hostId: '',
  players: [],
  round: 0,
  myWord: '',
  isImposter: false,
  wordRevealed: false,
  hasVoted: false,
  timerInterval: null,
};

// ── Helpers ──────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  window.scrollTo(0, 0);
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

function clearTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}

function startTimer(endTime, displayId, barId, totalSecs) {
  clearTimer();
  const display = displayId ? $(displayId) : null;
  const bar = $(barId);

  function tick() {
    const rem = Math.max(0, endTime - Date.now());
    const secs = Math.ceil(rem / 1000);
    if (display) {
      const m = Math.floor(secs / 60), s = secs % 60;
      display.textContent = `${m}:${String(s).padStart(2, '0')}`;
      display.classList.toggle('urgent', rem < 30000);
    }
    const pct = (rem / (totalSecs * 1000)) * 100;
    bar.style.width = `${Math.max(0, pct)}%`;
    bar.classList.toggle('urgent', rem < 30000);
    if (rem <= 0) clearTimer();
  }
  tick();
  state.timerInterval = setInterval(tick, 500);
}

function buildPlayerList(containerId, players, hostId, showScores = false) {
  const el = $(containerId);
  el.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `
      <div class="p-avatar">${p.name[0].toUpperCase()}</div>
      <div class="p-name">${p.name}${p.id === state.myId ? ' <em style="opacity:.5;font-style:normal">(you)</em>' : ''}</div>
      ${p.id === hostId ? '<span class="host-badge">HOST</span>' : ''}
      ${showScores ? `<span class="score-badge">${p.score} pts</span>` : ''}
    `;
    el.appendChild(div);
  });
}

function setupQR(code, serverUrl) {
  const wrap = $('qr-wrap');
  wrap.innerHTML = '';
  const joinUrl = `${serverUrl}/?join=${code}`;
  $('server-url').textContent = serverUrl;
  if (typeof QRCode !== 'undefined') {
    new QRCode(wrap, { text: joinUrl, width: 150, height: 150, colorDark: '#ffffff', colorLight: '#0d0d1a' });
  }
}

function renderScoreboard(players, imposterId) {
  const el = $('scoreboard');
  el.innerHTML = '';
  const max = Math.max(...players.map(p => p.score), 1);
  [...players].sort((a, b) => b.score - a.score).forEach(p => {
    const pct = Math.max((p.score / max) * 100, 8);
    const isImp = p.id === imposterId;
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <div class="score-name">${p.name}</div>
      <div class="score-bar-bg">
        <div class="score-bar-fill ${isImp ? 'imp-fill' : ''}" style="width:${pct}%">${p.score}</div>
      </div>
    `;
    el.appendChild(row);
  });
}

function updateLobbyUI(players, hostId) {
  buildPlayerList('lobby-player-list', players, hostId);
  $('player-count').textContent = `${players.length} / 12`;
  if (state.isHost) {
    const enough = players.length >= 3;
    $('btn-start').disabled = !enough;
    $('start-hint').textContent = enough ? 'Ready to start!' : `Need ${3 - players.length} more player${3 - players.length !== 1 ? 's' : ''} to start`;
  }
}

// ── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Auto-fill join code from URL
  const joinParam = new URLSearchParams(location.search).get('join');
  if (joinParam) $('input-code').value = joinParam.toUpperCase();

  $('btn-create').addEventListener('click', doCreate);
  $('btn-join').addEventListener('click', doJoin);
  $('input-name').addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
  $('input-code').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  $('input-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  $('btn-start').addEventListener('click', () => socket.emit('start-game', { code: state.roomCode }));
  $('word-card').addEventListener('click', revealWord);
  $('btn-ready').addEventListener('click', markReady);
  $('btn-skip-discuss').addEventListener('click', () => socket.emit('force-discussion', { code: state.roomCode }));
  $('btn-start-vote').addEventListener('click', () => socket.emit('force-voting', { code: state.roomCode }));
  $('btn-next-round').addEventListener('click', () => socket.emit('next-round', { code: state.roomCode }));
  $('btn-back-lobby').addEventListener('click', () => socket.emit('back-to-lobby', { code: state.roomCode }));
});

function doCreate() {
  const name = $('input-name').value.trim();
  if (!name) { showError('home-error', 'Please enter your name'); return; }
  state.myName = name;
  socket.emit('create-room', { playerName: name });
}

function doJoin() {
  const name = $('input-name').value.trim();
  const code = $('input-code').value.trim().toUpperCase();
  if (!name) { showError('home-error', 'Please enter your name'); return; }
  if (code.length < 6) { showError('home-error', 'Enter the 6-character room code'); return; }
  state.myName = name;
  socket.emit('join-room', { playerName: name, code });
}

function revealWord() {
  if (state.wordRevealed) return;
  state.wordRevealed = true;
  $('flip-inner').classList.add('flipped');
  if (state.isImposter) {
    $('flip-back').classList.add('imp-back');
    $('imp-tag').classList.remove('hidden');
    $('word-sub').textContent = '⚠️ You are the imposter! Blend in!';
  } else {
    $('word-sub').textContent = `✅ Your word is "${state.myWord}". Find the imposter!`;
  }
  $('btn-ready').disabled = false;
}

function markReady() {
  $('btn-ready').disabled = true;
  $('btn-ready').textContent = '✓ READY';
  socket.emit('player-ready', { code: state.roomCode });
}

// ── Socket events ─────────────────────────────────────────

socket.on('connect', () => { state.myId = socket.id; });

socket.on('room-created', ({ code, player, serverUrl }) => {
  state.myId = player.id;
  state.roomCode = code;
  state.isHost = true;
  state.hostId = player.id;
  state.players = [player];

  $('lobby-code').textContent = code;
  $('host-lobby-ctrl').classList.remove('hidden');
  $('guest-lobby-wait').classList.add('hidden');
  updateLobbyUI([player], player.id);
  setupQR(code, serverUrl);
  showScreen('lobby');
});

socket.on('joined-room', ({ code, player, players, hostId, serverUrl }) => {
  state.myId = player.id;
  state.roomCode = code;
  state.isHost = false;
  state.hostId = hostId;
  state.players = players;

  $('lobby-code').textContent = code;
  $('host-lobby-ctrl').classList.add('hidden');
  $('guest-lobby-wait').classList.remove('hidden');
  updateLobbyUI(players, hostId);
  setupQR(code, serverUrl);
  showScreen('lobby');
});

socket.on('player-joined', ({ players }) => {
  state.players = players;
  updateLobbyUI(players, state.hostId);
});

socket.on('player-left', ({ players, playerName, newHostId }) => {
  state.players = players;
  if (newHostId) {
    state.hostId = newHostId;
    if (newHostId === state.myId) {
      state.isHost = true;
      $('host-lobby-ctrl').classList.remove('hidden');
      $('guest-lobby-wait').classList.add('hidden');
    }
  }
  updateLobbyUI(players, state.hostId);
  buildPlayerList('discuss-players', players, state.hostId);
});

socket.on('join-error', msg => showError('home-error', msg));
socket.on('game-error', msg => showError('home-error', msg));

socket.on('round-started', ({ round, category, word, isImposter, players, endTime, hostId }) => {
  clearTimer();
  state.round = round;
  state.myWord = word;
  state.myCategory = category;
  state.isImposter = isImposter;
  state.players = players;
  state.hostId = hostId;
  state.wordRevealed = false;
  state.hasVoted = false;

  // Reset card
  $('flip-inner').classList.remove('flipped');
  $('flip-back').classList.remove('imp-back');
  $('imp-tag').classList.add('hidden');
  $('word-display').textContent = isImposter ? category : word;
  $('category-display').textContent = category;
  $('word-sub').textContent = 'Tap the card to reveal';
  $('btn-ready').disabled = true;
  $('btn-ready').textContent = "I'M READY";
  $('word-round').textContent = `Round ${round}`;
  $('ready-txt').textContent = `0 / ${players.length} ready`;

  if (state.isHost) {
    $('host-skip').classList.remove('hidden');
  } else {
    $('host-skip').classList.add('hidden');
  }

  // Timer bar only (no number display on word screen)
  startTimer(endTime, null, 'word-bar', 60);

  // Countdown text
  const cdEl = $('word-countdown');
  const cdInterval = setInterval(() => {
    const rem = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    cdEl.textContent = rem > 0 ? `Auto-starting discussion in ${rem}s` : '';
    if (rem <= 0) clearInterval(cdInterval);
  }, 1000);

  showScreen('word');
});

socket.on('ready-update', ({ readyCount, totalPlayers }) => {
  $('ready-txt').textContent = `${readyCount} / ${totalPlayers} ready`;
});

socket.on('discussion-started', ({ endTime, players, hostId }) => {
  clearTimer();
  state.players = players;
  state.hostId = hostId;
  $('discuss-round').textContent = `Round ${state.round}`;
  buildPlayerList('discuss-players', players, hostId);

  if (state.isHost) {
    $('host-vote-ctrl').classList.remove('hidden');
    $('guest-discuss-wait').classList.add('hidden');
  } else {
    $('host-vote-ctrl').classList.add('hidden');
    $('guest-discuss-wait').classList.remove('hidden');
  }

  startTimer(endTime, 'discuss-timer', 'discuss-bar', 180);
  showScreen('discuss');
});

socket.on('voting-started', ({ players, hostId }) => {
  clearTimer();
  state.players = players;
  state.hostId = hostId;
  state.hasVoted = false;
  $('vote-round').textContent = `Round ${state.round}`;
  $('vote-status').textContent = `0 / ${players.length} votes cast`;
  $('voted-wait').classList.add('hidden');

  const grid = $('vote-grid');
  grid.innerHTML = '';
  grid.style.opacity = '1';

  players.forEach(p => {
    if (p.id === state.myId) return; // can't vote for self
    const btn = document.createElement('button');
    btn.className = 'vote-btn';
    btn.textContent = p.name;
    btn.dataset.pid = p.id;
    btn.addEventListener('click', () => {
      if (state.hasVoted) return;
      state.hasVoted = true;
      btn.classList.add('voted-for');
      grid.querySelectorAll('.vote-btn').forEach(b => { b.disabled = true; });
      grid.style.opacity = '0.5';
      $('voted-wait').classList.remove('hidden');
      socket.emit('cast-vote', { code: state.roomCode, votedForId: p.id });
    });
    grid.appendChild(btn);
  });

  showScreen('vote');
});

socket.on('vote-update', ({ voteCount, totalPlayers }) => {
  $('vote-status').textContent = `${voteCount} / ${totalPlayers} votes cast`;
});

socket.on('round-results', ({ imposterId, imposterName, category, word, imposterCaught, players, hostId }) => {
  clearTimer();
  state.players = players;
  state.hostId = hostId;

  $('results-round').textContent = `Round ${state.round}`;
  $('result-imp-name').textContent = imposterName.toUpperCase();
  $('result-category').textContent = category;
  $('result-word').textContent = word;

  const banner = $('outcome-banner');
  if (imposterCaught) {
    banner.className = 'outcome-banner caught';
    $('outcome-icon').textContent = '🎉';
    $('outcome-text').textContent = 'Imposter Caught! Civilians win!';
  } else {
    banner.className = 'outcome-banner escaped';
    $('outcome-icon').textContent = '😈';
    $('outcome-text').textContent = 'Imposter Escaped! Imposter wins!';
  }

  renderScoreboard(players, imposterId);

  if (state.isHost) {
    $('host-results-ctrl').classList.remove('hidden');
    $('guest-results-wait').classList.add('hidden');
  } else {
    $('host-results-ctrl').classList.add('hidden');
    $('guest-results-wait').classList.remove('hidden');
  }

  showScreen('results');
});

socket.on('back-to-lobby', ({ players, hostId }) => {
  clearTimer();
  state.players = players;
  state.hostId = hostId;
  state.round = 0;

  $('lobby-code').textContent = state.roomCode;
  updateLobbyUI(players, hostId);

  if (state.isHost) {
    $('host-lobby-ctrl').classList.remove('hidden');
    $('guest-lobby-wait').classList.add('hidden');
  } else {
    $('host-lobby-ctrl').classList.add('hidden');
    $('guest-lobby-wait').classList.remove('hidden');
  }

  showScreen('lobby');
});

socket.on('host-changed', ({ newHostId }) => {
  state.hostId = newHostId;
  if (newHostId === state.myId) state.isHost = true;
});
