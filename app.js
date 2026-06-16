// ════════════════════════════════════════════════════════════════
//  BINGO · APP PRINCIPAL
//  Vanilla JS + Firebase Realtime Database
//  Modo single-game (sem códigos de sala)
// ════════════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
  getDatabase, ref, set, get, update, onValue, remove
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';
import { firebaseConfig, TEACHER_PIN } from './firebase-config.js';

// ─── Firebase init ──────────────────────────────────────────────
const fbApp = initializeApp(firebaseConfig);
const db = getDatabase(fbApp);

// ─── Estado global ──────────────────────────────────────────────
// ─── Configurações de emoção ────────────────────────────────────
const ROUND_SECONDS = 45;   // tempo pra responder após o sorteio (trava depois)

const state = {
  view: 'landing',
  isTeacher: false,
  player: null,
  game: null,
  players: {},
  bingoData: null,
  defaultBingos: {},   // {id: bingoObj} — carregados de bingos/*.json
  customBingos: {},    // {id: bingoObj} — vindos do Firebase
  modal: null,
  showCelebrate: null,
  lastWins: { linha: false, bingo: false },
  lastMarkCount: 0,        // pra detectar marca nova e tocar som
  roundExpired: false,     // cronômetro da rodada estourou
  unsub: { game: null, players: null, customBingos: null },
  pinError: false,
  joinError: null,
  uploadError: null,
  uploadPreview: null,
  pendingJoinName: null,   // nome aguardando o jogo começar
  revealAnswer: false,     // professor revelou a resposta (botão olho)
  scoreboard: false,       // modo placar projetável ao vivo (nesta tela)
  standaloneScoreboard: false  // janela dedicada de placar (?placar=1)
};

let timerInterval = null;

function setState(updates) {
  Object.assign(state, updates);
  render();
}

// ─── Sons (WebAudio, sem arquivos) ──────────────────────────────
let _audioCtx = null;
function audioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  return _audioCtx;
}
function tone(freq, start, dur, type = 'sine', vol = 0.12) {
  const ctx = audioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, ctx.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur);
}
function soundCorrect() { tone(523, 0, 0.12); tone(784, 0.1, 0.18); }
function soundWrong()   { tone(196, 0, 0.25, 'sawtooth', 0.08); }
function soundLinha()   { [523, 659, 784].forEach((f, i) => tone(f, i * 0.1, 0.15)); }
function soundBingo()   { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.16)); }
function soundTick()    { tone(880, 0, 0.05, 'square', 0.05); }

// ─── Sequência de acertos (streak) ─────────────────────────────
function currentStreak(marksObj) {
  const marks = marksToArray(marksObj).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let streak = 0;
  for (let i = marks.length - 1; i >= 0; i--) {
    if (marks[i].correct) streak++;
    else break;
  }
  return streak;
}

// ─── Utilitários ────────────────────────────────────────────────
const LINES = [
  [0,1,2,3],[4,5,6,7],[8,9,10,11],[12,13,14,15],
  [0,4,8,12],[1,5,9,13],[2,6,10,14],[3,7,11,15],
  [0,5,10,15],[3,6,9,12]
];

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function slugify(s) {
  return s.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

function marksToArray(marks) {
  if (!marks) return [];
  const arr = Array.isArray(marks) ? marks : Object.values(marks);
  // filtra entradas inválidas (null, undefined, ou sem campos esperados)
  return arr.filter(m => m && typeof m === 'object' && typeof m.cellIdx === 'number');
}

function checkWins(marksObj) {
  const marks = marksToArray(marksObj);
  const grid = Array(16).fill(null);
  const tsGrid = Array(16).fill(null); // timestamp do acerto em cada célula
  marks.forEach(m => {
    if (m.correct) {
      grid[m.cellIdx] = 'c';
      tsGrid[m.cellIdx] = m.ts || null;
    } else if (grid[m.cellIdx] !== 'c') {
      grid[m.cellIdx] = 'w';
    }
  });
  // LINHA: momento em que a PRIMEIRA linha foi completada
  // (= menor, entre as linhas completas, do maior ts da linha)
  let linha = false;
  let linhaAt = null;
  LINES.forEach(line => {
    if (line.every(i => grid[i] === 'c')) {
      linha = true;
      const completedAt = Math.max(...line.map(i => tsGrid[i] || 0));
      if (linhaAt === null || completedAt < linhaAt) linhaAt = completedAt;
    }
  });
  // BINGO: momento em que a 16ª célula ficou verde
  const bingo = grid.every(c => c === 'c');
  const bingoAt = bingo ? Math.max(...tsGrid.map(t => t || 0)) : null;
  const correct = marks.filter(m => m.correct).length;
  const wrong = marks.filter(m => !m.correct).length;
  return { linha, bingo, correct, wrong, grid, linhaAt, bingoAt };
}

function avgResponseSeconds(playerMarks, drawnAt) {
  const marks = marksToArray(playerMarks);
  if (!marks.length || !drawnAt) return null;
  const times = marks.map(m => {
    const dt = drawnAt && drawnAt[m.sentenceIdx];
    if (!dt) return null;
    return (m.ts - dt) / 1000;
  }).filter(t => t !== null && t > 0);
  if (!times.length) return null;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

function buildUniqueCard(distribution, existingPlayers) {
  // ESCASSEZ: cada cartela passa por 2 trocas aleatórias —
  // categorias perdem/ganham ocorrências. Nunca remove a ÚLTIMA
  // ocorrência de uma categoria, então toda cartela mantém todas
  // as categorias disponíveis (só varia a quantidade).
  const SCARCITY_SWAPS = 2;
  const existingHashes = new Set(
    Object.values(existingPlayers || {}).map(p => (p.cardLayout || []).join('|'))
  );
  let card, attempts = 0;
  do {
    let pool = [...distribution];
    for (let swap = 0; swap < SCARCITY_SWAPS; swap++) {
      // conta ocorrências de cada categoria no pool atual
      const counts = {};
      pool.forEach(c => counts[c] = (counts[c] || 0) + 1);
      // só remove de categorias que têm mais de 1 ocorrência (preserva todas)
      const removableIdxs = [];
      pool.forEach((c, i) => { if (counts[c] > 1) removableIdxs.push(i); });
      if (removableIdxs.length === 0) break;
      const removeIdx = removableIdxs[Math.floor(Math.random() * removableIdxs.length)];
      const removedVal = pool[removeIdx];
      pool.splice(removeIdx, 1);
      // duplica uma categoria diferente da removida
      const candidates = pool.filter(x => x !== removedVal);
      const dup = (candidates.length > 0 ? candidates : pool)[
        Math.floor(Math.random() * (candidates.length > 0 ? candidates.length : pool.length))
      ];
      pool.push(dup);
    }
    card = shuffle(pool);
    attempts++;
  } while (existingHashes.has(card.join('|')) && attempts < 200);
  return card;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getBingo(id) {
  return state.customBingos[id] || state.defaultBingos[id] || null;
}

function allBingos() {
  return { ...state.defaultBingos, ...state.customBingos };
}

// ─── LocalStorage ───────────────────────────────────────────────
function saveSession(data) {
  try { localStorage.setItem('bingo-session', JSON.stringify(data)); } catch {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem('bingo-session') || 'null'); } catch { return null; }
}
function clearSession() {
  try { localStorage.removeItem('bingo-session'); } catch {}
}

// ─── Carregamento dos bingos default ────────────────────────────
async function loadDefaultBingos() {
  try {
    const idxRes = await fetch('bingos/index.json', { cache: 'no-store' });
    const ids = await idxRes.json();
    const metas = {};
    await Promise.all(ids.map(async id => {
      const r = await fetch(`bingos/${id}.json`, { cache: 'no-store' });
      const data = await r.json();
      data.builtin = true;
      metas[id] = data;
    }));
    return metas;
  } catch (e) {
    console.error('Falha ao carregar bingos default:', e);
    return {};
  }
}

// ─── Validação de bingo enviado pelo usuário ────────────────────
function validateBingoData(data) {
  const errors = [];
  if (typeof data !== 'object' || !data) {
    return ['O arquivo precisa conter um objeto JSON.'];
  }
  if (!data.id || typeof data.id !== 'string') {
    errors.push('Falta o campo "id" (ex: "crase").');
  } else if (!/^[a-z0-9-]+$/.test(data.id)) {
    errors.push('O "id" só pode ter letras minúsculas, números e hífens.');
  }
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Falta o campo "name" (nome que aparece no menu).');
  }
  if (!Array.isArray(data.sentences) || data.sentences.length < 4) {
    errors.push('"sentences" precisa ser uma lista com pelo menos 4 frases (recomendado: 30+).');
  } else {
    data.sentences.forEach((s, i) => {
      if (!s || typeof s.text !== 'string' || typeof s.answer !== 'string') {
        errors.push(`Frase #${i + 1}: precisa ter "text" e "answer" (texto).`);
      }
    });
  }
  if (!Array.isArray(data.distribution) || data.distribution.length !== 16) {
    errors.push('"distribution" precisa ser uma lista com exatamente 16 itens.');
  }
  if (Array.isArray(data.sentences) && Array.isArray(data.distribution) && errors.length === 0) {
    const distSet = new Set(data.distribution);
    const ansSet = new Set(data.sentences.map(s => s.answer));
    const missing = [...ansSet].filter(a => !distSet.has(a));
    if (missing.length) {
      errors.push(`Estas respostas aparecem nas frases mas não estão na distribution: ${missing.join(', ')}.`);
    }
    const unused = [...distSet].filter(d => !ansSet.has(d));
    if (unused.length) {
      errors.push(`Estes itens estão na distribution mas nenhuma frase os usa: ${unused.join(', ')}.`);
    }
  }
  return errors;
}

// ─── Firebase: ações de jogo ────────────────────────────────────
async function dbStartGame(gameType) {
  await remove(ref(db, 'players'));
  const game = {
    gameType,
    currentSentenceIdx: -1,
    drawnIndices: [],
    drawnAt: {},
    phase: 'lobby',
    createdAt: Date.now()
  };
  await set(ref(db, 'game'), game);
}

async function dbGetGame() {
  const snap = await get(ref(db, 'game'));
  return snap.val();
}

async function dbGetPlayers() {
  const snap = await get(ref(db, 'players'));
  return snap.val() || {};
}

async function dbJoinAsPlayer(name) {
  const baseSlug = slugify(name) || `aluno-${Math.floor(Math.random() * 10000)}`;
  const game = await dbGetGame();
  if (!game) return { error: 'no-game' };

  const players = await dbGetPlayers();

  // Sessão local: retomar apenas se for o MESMO jogo (createdAt igual),
  // o slug ainda existir e o nome bater
  const sess = loadSession();
  let slug;
  if (
    sess?.slug && players[sess.slug] && players[sess.slug].name === name &&
    sess.gameCreatedAt && sess.gameCreatedAt === game.createdAt
  ) {
    slug = sess.slug;
    await update(ref(db, `players/${slug}`), { lastSeen: Date.now() });
    return { slug, player: { slug, ...players[slug], lastSeen: Date.now() } };
  }

  slug = baseSlug;
  let i = 2;
  while (players[slug]) {
    slug = `${baseSlug}-${i}`;
    i++;
  }

  const bingo = getBingo(game.gameType);
  if (!bingo) return { error: 'no-bingo' };
  const cardLayout = buildUniqueCard(bingo.distribution, players);

  const player = {
    name,
    cardLayout,
    marks: {},
    joinedAt: Date.now(),
    lastSeen: Date.now()
  };
  await set(ref(db, `players/${slug}`), player);
  return { slug, player: { slug, ...player } };
}

async function dbMarkCell(slug, sentenceIdx, cellIdx, correct) {
  await set(ref(db, `players/${slug}/marks/${sentenceIdx}`), {
    cellIdx, correct, sentenceIdx, ts: Date.now()
  });
  await update(ref(db, `players/${slug}`), { lastSeen: Date.now() });
}

async function dbDrawNext(sentencesCount) {
  const snap = await get(ref(db, 'game'));
  const game = snap.val();
  if (!game) return;
  const available = [];
  for (let i = 0; i < sentencesCount; i++) {
    if (!(game.drawnIndices || []).includes(i)) available.push(i);
  }
  if (!available.length) return;
  const next = available[Math.floor(Math.random() * available.length)];
  const ts = Date.now();
  await update(ref(db, 'game'), {
    currentSentenceIdx: next,
    drawnIndices: [...(game.drawnIndices || []), next],
    [`drawnAt/${next}`]: ts,
    phase: 'playing'
  });
}

async function dbEndGame() {
  await update(ref(db, 'game'), {
    phase: 'ended',
    currentSentenceIdx: -1,
    endedAt: Date.now()
  });
}

async function dbReopenGame() {
  await update(ref(db, 'game'), { phase: 'playing' });
}

async function dbResetEverything() {
  await remove(ref(db, 'game'));
  await remove(ref(db, 'players'));
}

// ─── Firebase: bingos customizados ──────────────────────────────
async function dbUploadCustomBingo(bingoData) {
  bingoData.custom = true;
  bingoData.uploadedAt = Date.now();
  await set(ref(db, `bingos/${bingoData.id}`), bingoData);
}

async function dbDeleteCustomBingo(id) {
  await remove(ref(db, `bingos/${id}`));
}

// ─── Listeners ──────────────────────────────────────────────────
function clearListeners() {
  if (state.unsub.game) { state.unsub.game(); state.unsub.game = null; }
  if (state.unsub.players) { state.unsub.players(); state.unsub.players = null; }
}

function attachGameListener() {
  state.unsub.game = onValue(ref(db, 'game'), snap => {
    const gameData = snap.val();
    setState({ game: gameData });

    if (gameData?.gameType) {
      const bd = getBingo(gameData.gameType);
      if (bd && bd.id !== state.bingoData?.id) {
        setState({ bingoData: bd });
      }
    }

    // se sou estudante aguardando o jogo começar, tentar entrar
    if (state.pendingJoinName && gameData && gameData.gameType && gameData.phase !== 'ended') {
      const name = state.pendingJoinName;
      state.pendingJoinName = null;
      (async () => {
        const result = await dbJoinAsPlayer(name);
        if (result.player) {
          saveSession({ role: 'student', slug: result.slug, name, gameCreatedAt: gameData.createdAt });
          const bd = getBingo(gameData.gameType);
          state.lastWins = { linha: false, bingo: false };
          setState({ player: result.player, bingoData: bd });
        }
      })();
    }
  });
}

function attachPlayersListener() {
  state.unsub.players = onValue(ref(db, 'players'), snap => {
    const allPlayers = snap.val() || {};
    setState({ players: allPlayers });

    if (state.view === 'student' && state.player?.slug) {
      const me = allPlayers[state.player.slug];
      if (me) {
        const updated = { slug: state.player.slug, ...me };
        const wins = checkWins(me.marks);
        if (wins.bingo && !state.lastWins.bingo) {
          state.lastWins.bingo = true;
          state.lastWins.linha = true;
          soundBingo();
          triggerCelebrate('BINGO!');
        } else if (wins.linha && !state.lastWins.linha) {
          state.lastWins.linha = true;
          soundLinha();
          triggerCelebrate('LINHA!');
        }
        setState({ player: updated });
      } else if (state.player.slug) {
        // fui removido pelo reset
        clearSession();
        setState({
          view: 'landing', player: null, game: null,
          joinError: 'O professor reiniciou o jogo. Entre de novo.',
          lastWins: { linha: false, bingo: false }
        });
      }
    }
  });
}

function attachCustomBingosListener() {
  state.unsub.customBingos = onValue(ref(db, 'bingos'), snap => {
    const customs = snap.val() || {};
    const valid = {};
    Object.entries(customs).forEach(([id, data]) => {
      if (Array.isArray(data?.sentences) && Array.isArray(data?.distribution)) {
        valid[id] = data;
      }
    });
    setState({ customBingos: valid });
  });
}

// ─── Celebração ────────────────────────────────────────────────
const BINGO_MSGS = [
  'BINGO!',
  'BINGÃO!',
  'CARTELA CHEIA!',
  'ARRASOU, ARRASOU!',
  'O MESTRE TÁ ORGULHOSO!',
  'GENIALIDADE DETECTADA!',
  'O MESTRE NEM PRECISAVA TER ENSINADO!',
  'DEUSES DA GRAMÁTICA SORRIRAM PRA VOCÊ!',
  'IMPRESSIONANTE — E O MESTRE NÃO SE IMPRESSIONA FÁCIL!'
];
const LINHA_MSGS = [
  'LINHA!',
  'LINHA CHEIA!',
  'ÊÊÊ!',
  'BORA, BORA!',
  'TÁ VOANDO!',
  'O MESTRE TÁ DE OLHO!',
  'QUASE O MESTRE!',
  'LINDOOOO!'
];

function triggerCelebrate(type) {
  const pool = type === 'BINGO!' ? BINGO_MSGS : LINHA_MSGS;
  const text = pool[Math.floor(Math.random() * pool.length)];
  setState({ showCelebrate: text });
  setTimeout(() => setState({ showCelebrate: null }), type === 'BINGO!' ? 4000 : 2500);
}

// ════════════════════════════════════════════════════════════════
//  RENDERIZAÇÃO
// ════════════════════════════════════════════════════════════════

function render() {
  const root = document.getElementById('root');
  let html = '';

  // janela dedicada de placar (aberta com ?placar=1): só mostra o placar
  if (state.standaloneScoreboard) {
    html = renderStandaloneScoreboard();
    root.innerHTML = html;
    attachListeners();
    return;
  }

  if (state.view === 'landing') html = renderLanding();
  else if (state.view === 'student') html = renderStudent();
  else if (state.view === 'teacher') html = renderTeacher();
  else if (state.view === 'error') html = renderError();

  if (state.modal) html += renderModal();
  if (state.showCelebrate) html += renderCelebrate();

  root.innerHTML = html;
  attachListeners();
  manageRoundTimer();
}

// placar em janela própria (read-only, sincroniza pelo Firebase)
function renderStandaloneScoreboard() {
  const game = state.game;
  if (!game || !game.gameType) {
    return `<div class="scoreboard-screen"><div class="sb-empty">aguardando o Mestre iniciar um jogo...</div></div>`;
  }
  const bd = getBingo(game.gameType);
  if (game.phase === 'ended') {
    // mostra ranking final na janela do projetor também
    return renderRankingScoreboardStyle(bd, game);
  }
  if (!bd) {
    return `<div class="scoreboard-screen"><div class="sb-empty">carregando...</div></div>`;
  }
  const sentences = bd.sentences || [];
  const playersArr = Object.entries(state.players || {}).map(([slug, p]) => ({ slug, ...p }));
  const ranked = rankPlayers(playersArr, game.drawnAt || {});
  return renderScoreboard(ranked, bd, game, sentences, true);
}

function renderRankingScoreboardStyle(bd, game) {
  const playersArr = Object.entries(state.players || {}).map(([slug, p]) => ({ slug, ...p }));
  const ranked = rankPlayers(playersArr, game.drawnAt || {});
  const medals = ['🥇', '🥈', '🥉'];
  return `
    <div class="scoreboard-screen">
      <div class="scoreboard-head">
        <div>
          <div class="sb-title">🏆 RESULTADO FINAL</div>
          <div class="sb-sub">${escapeHtml(bd?.name || '')}</div>
        </div>
      </div>
      <div class="scoreboard-list">
        ${ranked.map((p, i) => {
          const pos = i + 1;
          const cls = pos <= 3 ? `sb-top sb-pos-${pos}` : '';
          const status = p.bingo ? '🏆 BINGO' : p.linha ? '🎯 LINHA' : `${p.correct} ✓`;
          return `
            <div class="sb-row ${cls}">
              <div class="sb-rank">${medals[i] || pos + 'º'}</div>
              <div class="sb-name">${escapeHtml(p.name)}</div>
              <div class="sb-score">${status}</div>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ─── Cronômetro da rodada ───────────────────────────────────────
// Atualiza a barra direto no DOM (sem re-render completo) e dispara
// re-render quando o tempo estoura, travando a marcação.
function manageRoundTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (state.view !== 'student' || !state.game || !state.player?.slug) return;
  const idx = state.game.currentSentenceIdx;
  if (idx < 0) return;
  const drawnTs = (state.game.drawnAt || {})[idx];
  if (!drawnTs) return;
  const marks = marksToArray(state.player.marks);
  if (marks.some(m => m.sentenceIdx === idx)) return; // já marcou

  let lastTickSecond = -1;
  const update = () => {
    const elapsed = (Date.now() - drawnTs) / 1000;
    const left = Math.max(0, ROUND_SECONDS - elapsed);
    const bar = document.getElementById('round-timer-bar');
    const txt = document.getElementById('round-timer-text');
    if (bar) {
      const pct = (left / ROUND_SECONDS) * 100;
      bar.style.width = pct + '%';
      bar.style.background = left <= 10 ? 'var(--red)' : left <= 20 ? 'var(--yellow)' : 'var(--green)';
    }
    if (txt) {
      txt.textContent = left > 0 ? `⏱ ${Math.ceil(left)}s` : '⏰';
    }
    // tic-tac sonoro nos últimos 5 segundos
    const sec = Math.ceil(left);
    if (left > 0 && left <= 5 && sec !== lastTickSecond) {
      lastTickSecond = sec;
      soundTick();
    }
    if (left <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      setState({ roundExpired: true }); // re-render trava as células
    }
  };
  update();
  timerInterval = setInterval(update, 200);
}

// ─── LANDING ────────────────────────────────────────────────────
function renderLanding() {
  return `
    <div class="ticker-fixed-top ticker"></div>
    <div class="ticker-fixed-bottom ticker"></div>
    <div class="center-screen">
      <div style="width: 100%; max-width: 460px;" class="pop-in">
        <div class="text-center mb-4">
          <div class="display" style="font-size: 11px; color: var(--red); letter-spacing: 0.3em; margin-bottom: 6px;">
            ★ ★ ★ ★ ★
          </div>
          <div class="display" style="font-size: 11px; color: var(--navy); letter-spacing: 0.18em; opacity: 0.7;">
            APRESENTAÇÃO TRIUNFAL · EVENTO ÚNICO · INESQUECÍVEL
          </div>
          <div class="display" style="font-size: 28px; color: var(--red); letter-spacing: 0.04em; margin-top: 6px; line-height: 1;">
            MESTRE LINDÃO
          </div>
          <div class="display" style="font-size: 38px; color: var(--navy); letter-spacing: 0.04em; line-height: 1;">
            PAULO HENRIQUE
          </div>
          <div class="display" style="font-size: 11px; color: var(--navy); letter-spacing: 0.18em; opacity: 0.7; margin-top: 4px;">
            (o melhor professor de português conhecido)
          </div>
          <div class="display" style="font-size: 12px; color: var(--navy); letter-spacing: 0.2em; margin: 14px 0 6px;">
            apresenta com exclusividade:
          </div>
          <h1 class="display" style="font-size: 88px; color: var(--navy); line-height: 0.9;">
            BIN<span style="color: var(--red);">GO</span>
          </h1>
          <div class="display" style="font-size: 18px; color: rgba(26,35,126,0.65); margin-top: 6px;">
            de língua portuguesa
          </div>
          <div class="display" style="font-size: 11px; color: rgba(26,35,126,0.5); letter-spacing: 0.1em; margin-top: 4px;">
            90% carisma · 10% gramática · 100% Mestre
          </div>
        </div>

        <div class="card">
          <label>Seu nome, humilde aprendiz</label>
          <input
            type="text"
            id="input-name"
            class="input"
            placeholder="Como devo te chamar?"
            maxlength="30"
            autocomplete="off"
          >

          ${state.joinError ? `<div style="color: var(--red); font-size: 13px; margin-top: 10px;">${escapeHtml(state.joinError)}</div>` : ''}

          <button id="btn-join" class="btn btn-primary mt-3" style="width: 100%;">
            ENTRAR (e tentar superar o Mestre) →
          </button>

          <button id="btn-teacher" class="btn-link mt-3" style="display: block; margin: 12px auto 0; text-align: center;">
            sou o próprio Mestre · ou plebeu autorizado
          </button>
        </div>

        <div class="text-center mt-4" style="font-size: 10px; color: rgba(26,35,126,0.55); letter-spacing: 0.1em; font-family: 'Bricolage Grotesque';">
          PREMIADO POR NENHUMA INSTITUIÇÃO · MAS O MELHOR MESMO ASSIM
        </div>
      </div>
    </div>
  `;
}

// ─── Ordenação compartilhada (com desempate sutil por velocidade) ──
function rankPlayers(playersArr, drawnAt) {
  return playersArr.map(p => {
    const wins = checkWins(p.marks);
    const avgSec = avgResponseSeconds(p.marks, drawnAt);
    return { ...p, ...wins, avgSec };
  }).sort((a, b) => {
    if (a.bingo !== b.bingo) return b.bingo - a.bingo;
    if (a.bingo && b.bingo && a.bingoAt !== b.bingoAt) return a.bingoAt - b.bingoAt;
    if (a.linha !== b.linha) return b.linha - a.linha;
    if (a.linha && b.linha && a.linhaAt !== b.linhaAt) return a.linhaAt - b.linhaAt;
    if (a.correct !== b.correct) return b.correct - a.correct;
    if (a.wrong !== b.wrong) return a.wrong - b.wrong;
    // desempate sutil: quem respondeu mais rápido em média
    if (a.avgSec != null && b.avgSec != null && a.avgSec !== b.avgSec) return a.avgSec - b.avgSec;
    return 0;
  });
}

// ─── Placar projetável ao vivo ──────────────────────────────────
function renderScoreboard(ranked, bd, game, sentences, standalone = false) {
  const drawn = game.drawnIndices || [];
  const current = game.currentSentenceIdx >= 0 ? sentences[game.currentSentenceIdx] : null;
  const medals = ['🥇', '🥈', '🥉'];

  return `
    <div class="scoreboard-screen">
      <div class="scoreboard-head">
        <div>
          <div class="sb-title">🏆 PLACAR AO VIVO</div>
          <div class="sb-sub">${escapeHtml(bd.name)} · frase ${drawn.length} de ${sentences.length}</div>
        </div>
        ${standalone ? '' : `<button id="btn-close-scoreboard" class="btn btn-outline-red btn-small">← voltar ao painel</button>`}
      </div>

      <div class="scoreboard-list">
        ${ranked.length === 0 ? `
          <div class="sb-empty">aguardando os súditos entrarem...</div>
        ` : ranked.map((p, i) => {
          const pos = i + 1;
          const cls = pos <= 3 ? `sb-top sb-pos-${pos}` : '';
          const status = p.bingo ? '🏆 BINGO'
            : p.linha ? '🎯 LINHA'
            : `${p.correct} ✓`;
          return `
            <div class="sb-row ${cls}">
              <div class="sb-rank">${medals[i] || pos + 'º'}</div>
              <div class="sb-name">${escapeHtml(p.name)} ${currentStreak(p.marks) >= 3 ? `<span class="streak-badge">🔥x${currentStreak(p.marks)}</span>` : ''}</div>
              <div class="sb-score">${status}</div>
            </div>
          `;
        }).join('')}
      </div>

      ${current ? `
        <div class="sb-current">frase atual: <strong>"${escapeHtml(current.text)}"</strong></div>
      ` : `<div class="sb-current">o Mestre vai sortear a próxima...</div>`}
    </div>
  `;
}

// ─── TEACHER ────────────────────────────────────────────────────
function renderTeacher() {
  const game = state.game;

  if (!game) {
    const bingos = Object.values(allBingos());
    return `
      <div class="ticker"></div>
      <div class="app-header red">
        <div>
          <div class="title">🎩 TRONO DO MESTRE</div>
          <div class="sub">escolha qual lição vai dar hoje</div>
        </div>
        <button id="btn-exit-teacher" class="btn-link" style="color: white;">sair do trono</button>
      </div>
      <div class="container">

        <h2 class="display text-center mt-4 mb-3" style="font-size: 26px;">
          QUAL CONHECIMENTO O MESTRE VAI COMPARTILHAR?
        </h2>

        <div class="bingo-options">
          ${bingos.map(b => `
            <div class="bingo-option-wrapper">
              <button class="bingo-option" data-bingo-id="${escapeHtml(b.id)}">
                <div class="name">${escapeHtml(b.name)}</div>
                <div class="sub">${escapeHtml(b.subtitle || '')} · ${b.sentences.length} frases</div>
                ${b.custom ? '<div class="custom-badge">enviado por você</div>' : '<div class="builtin-badge">incluído</div>'}
              </button>
              ${b.custom ? `<button class="btn-delete-bingo" data-del-bingo="${escapeHtml(b.id)}" title="apagar este bingo">×</button>` : ''}
            </div>
          `).join('')}
        </div>

        <div class="upload-section mt-4">
          <button id="btn-add-bingo" class="btn btn-yellow">
            + ADICIONAR NOVO BINGO (arquivo .json)
          </button>
          <div class="upload-hint">
            Peça ao Claude um arquivo no formato certo, depois é só subir aqui.
          </div>
        </div>
      </div>
    `;
  }

  if (game.phase === 'ended') {
    return renderRanking();
  }

  const bd = state.bingoData;
  if (!bd) {
    return `<div class="center-screen"><div class="display" style="animation: pulse 1.5s infinite;">carregando bingo...</div></div>`;
  }

  const sentences = bd.sentences || [];
  const drawn = game.drawnIndices || [];
  const remaining = sentences.length - drawn.length;
  const current = game.currentSentenceIdx >= 0 ? sentences[game.currentSentenceIdx] : null;
  const playersArr = Object.entries(state.players || {}).map(([slug, p]) => ({ slug, ...p }));

  const ranked = rankPlayers(playersArr, game.drawnAt || {});

  // modo placar projetável
  if (state.scoreboard) {
    return renderScoreboard(ranked, bd, game, sentences);
  }

  const baseUrl = location.origin + location.pathname;

  return `
    <div class="ticker"></div>
    <div class="app-header red">
      <div>
        <div class="title">🎩 TRONO DO MESTRE</div>
        <div class="sub">${escapeHtml(bd.name)} · ${playersArr.length} aluno${playersArr.length === 1 ? '' : 's'} sob comando</div>
      </div>
      <button id="btn-exit-teacher" class="btn-link" style="color: white;">sair do trono</button>
    </div>

    <div class="container">

      <div class="link-banner">
        <div>
          <div class="link-banner-lbl">LINK DA AULA</div>
          <div class="link-banner-url">${escapeHtml(baseUrl)}</div>
        </div>
        <button id="btn-copy-link" class="btn btn-yellow btn-small">copiar</button>
      </div>

      <div class="sentence-panel">
        ${current ? `
          <div class="top">
            <div>Frase ${drawn.length} / ${sentences.length} · ${remaining} restantes</div>
            <div style="opacity: 0.6;">leia com a majestade habitual, duas vezes</div>
          </div>
          <div class="quote">"${escapeHtml(current.text)}"</div>
          <div class="answer-zone">
            <button id="btn-reveal" class="btn-reveal">
              ${state.revealAnswer ? '🙈 ocultar resposta' : '👁 ver resposta (só você)'}
            </button>
            ${state.revealAnswer ? `
              <div class="answer-secret">
                ${current.context ? `<span class="answer-secret-ctx">${escapeHtml(current.context)}</span>` : ''}
                <span class="answer-secret-main">${escapeHtml(current.answer)}</span>
              </div>
            ` : ''}
          </div>
        ` : `
          <div class="text-center" style="padding: 14px 0;">
            <div class="display" style="color: var(--yellow); font-size: 22px;">O MESTRE ESTÁ PRONTO</div>
            <div style="opacity: 0.8; font-size: 14px;">toque o botão amarelo e dê o pontapé inicial</div>
          </div>
        `}
      </div>

      <div class="action-row">
        <button id="btn-draw" class="btn btn-yellow" ${remaining === 0 ? 'disabled' : ''}>
          ${drawn.length === 0 ? '▶ COMEÇAR · SORTEAR PRIMEIRA' : remaining === 0 ? 'SEM MAIS FRASES' : '🎲 SORTEAR PRÓXIMA'}
        </button>
        <button id="btn-end" class="btn btn-outline-red" ${playersArr.length === 0 ? 'disabled' : ''}>
          🏁 ENCERRAR · VER RANKING
        </button>
        <button id="btn-reset" class="btn btn-outline-red">RESETAR</button>
      </div>

      <div class="scoreboard-launch">
        <button id="btn-scoreboard" class="btn btn-primary" ${playersArr.length === 0 ? 'disabled' : ''}>
          📺 PLACAR AO VIVO (nesta tela)
        </button>
        <button id="btn-scoreboard-window" class="btn btn-yellow" ${playersArr.length === 0 ? 'disabled' : ''}>
          🖥️ ABRIR EM 2ª JANELA (projetor)
        </button>
      </div>

      <div class="players-panel">
        <div class="header">
          <span>SÚDITOS NO JOGO</span>
          <span class="sub">atualiza em tempo real</span>
        </div>
        ${playersArr.length === 0 ? `
          <div class="text-center p-4" style="color: rgba(26,35,126,0.6);">
            Manda o link pra galera, Mestre. Os admiradores vão aparecer aqui.
          </div>
        ` : ranked.map(p => renderPlayerRow(p, game.currentSentenceIdx)).join('')}
      </div>

      ${drawn.length > 0 ? `
        <div class="history-row">
          <div class="lbl">já sorteadas (não repetem)</div>
          <div class="chips">
            ${drawn.map(idx => `
              <span class="history-chip">#${idx + 1} · ${escapeHtml(sentences[idx].answer)}</span>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderPlayerRow(p, currentSentenceIdx) {
  const marks = marksToArray(p.marks);
  const wins = checkWins(p.marks);
  const grid = Array(16).fill('').map((_, i) => {
    const c = wins.grid[i];
    return `<div class="mini-cell ${c === 'c' ? 'c' : c === 'w' ? 'w' : ''}"></div>`;
  }).join('');

  // suspense: está a 1 célula da LINHA? a 1 do BINGO?
  const greens = wins.grid.filter(c => c === 'c').length;
  const nearBingo = !wins.bingo && greens === 15;
  const nearLinha = !wins.linha && LINES.some(line =>
    line.filter(i => wins.grid[i] === 'c').length === 3
  );
  const streak = currentStreak(p.marks);

  const answeredCurrent = marks.find(m => m.sentenceIdx === currentSentenceIdx);
  let badge = '';
  if (wins.bingo) badge = `<span class="badge badge-bingo">🏆 BINGO</span>`;
  else if (nearBingo) badge = `<span class="badge badge-near">😱 A 1 DO BINGO!</span>`;
  else if (wins.linha && nearLinha) badge = `<span class="badge badge-linha">🎯 LINHA · quase outra!</span>`;
  else if (wins.linha) badge = `<span class="badge badge-linha">🎯 LINHA</span>`;
  else if (nearLinha) badge = `<span class="badge badge-near">⚡ a 1 da linha!</span>`;
  else if (currentSentenceIdx >= 0 && answeredCurrent) {
    badge = answeredCurrent.correct
      ? `<span class="badge badge-correct">✓ marcou</span>`
      : `<span class="badge badge-wrong">✗ errou</span>`;
  } else if (currentSentenceIdx >= 0) {
    badge = `<span class="badge badge-thinking">pensando...</span>`;
  } else {
    badge = `<span class="badge-waiting">aguardando</span>`;
  }

  return `
    <div class="player-row">
      <div class="mini-grid">${grid}</div>
      <div class="player-info">
        <div class="name">${escapeHtml(p.name)} ${streak >= 3 ? `<span class="streak-badge">🔥x${streak}</span>` : ''}</div>
        <div class="stats">
          <span style="color: var(--green); font-weight: 700;">${wins.correct} ✓</span>
          ${wins.wrong > 0 ? `<span style="color: var(--red); font-weight: 700; margin-left: 8px;">${wins.wrong} ✗</span>` : `<span style="color: rgba(26,35,126,0.4); margin-left: 8px;">0 ✗</span>`}
        </div>
      </div>
      ${badge}
    </div>
  `;
}

// ─── STUDENT ────────────────────────────────────────────────────
function renderStudent() {
  const game = state.game;
  const player = state.player;
  const bd = state.bingoData;

  // sem jogo ou sem cartela ainda → aguardando
  if (!game || !player?.slug) {
    return `
      <div class="ticker-fixed-top ticker"></div>
      <div class="center-screen">
        <div class="text-center" style="padding: 0 16px;">
          <div class="display" style="font-size: 34px; color: var(--navy);">olá, ${escapeHtml(player?.name || '')}!</div>
          <div class="display mt-2" style="font-size: 14px; color: rgba(26,35,126,0.55); letter-spacing: 0.1em;">
            VOCÊ AGUARDA SUA AUDIÊNCIA COM O MESTRE
          </div>
          <div class="display mt-4" style="font-size: 18px; color: var(--red); animation: pulse 1.5s infinite;">
            o Mestre Lindão já vem... segura aí 🫡
          </div>
          <div class="display mt-3" style="font-size: 12px; color: rgba(26,35,126,0.5); font-style: italic;">
            (provavelmente ele tá ajeitando a beleza)
          </div>
          <button id="btn-leave" class="btn-link mt-4">desistir da glória 🏃</button>
        </div>
      </div>
    `;
  }

  if (game.phase === 'ended') {
    return renderRanking();
  }

  if (!bd) {
    return `<div class="center-screen"><div class="display" style="animation: pulse 1.5s infinite;">conectando...</div></div>`;
  }

  const sentences = bd.sentences || [];
  const wins = checkWins(player.marks);
  const current = game.currentSentenceIdx >= 0 ? sentences[game.currentSentenceIdx] : null;
  const marks = marksToArray(player.marks);
  const alreadyMarked = current && marks.some(m => m.sentenceIdx === game.currentSentenceIdx);

  // cronômetro: quanto tempo desde o sorteio desta frase?
  const drawnTs = current ? (game.drawnAt || {})[game.currentSentenceIdx] : null;
  const elapsed = drawnTs ? (Date.now() - drawnTs) / 1000 : 0;
  const expired = drawnTs ? elapsed >= ROUND_SECONDS : false;
  const canMark = !!current && !alreadyMarked && !expired;

  // pressão social: quantos colegas já marcaram esta frase?
  const totalPlayers = Object.keys(state.players || {}).length;
  const answeredCount = current ? Object.values(state.players || {}).filter(p =>
    marksToArray(p.marks).some(m => m.sentenceIdx === game.currentSentenceIdx)
  ).length : 0;

  const streak = currentStreak(player.marks);

  return `
    <div class="ticker"></div>

    <div class="app-header">
      <div>
        <div class="title">${escapeHtml(player.name)} ${streak >= 3 ? `<span class="streak-badge">🔥x${streak}</span>` : ''}</div>
        <div class="sub">${escapeHtml(bd.name)}</div>
      </div>
      <div class="row gap-2">
        <div class="score-pill">
          <div class="n">${wins.correct}</div>
          <div class="lbl">acertos</div>
        </div>
        <div class="score-pill red">
          <div class="n">${wins.wrong}</div>
          <div class="lbl">erros</div>
        </div>
        <button id="btn-leave" class="btn-link" style="color: var(--yellow);">sair</button>
      </div>
    </div>

    <div style="display: flex; justify-content: center;">
      ${current ? (alreadyMarked ? `
        <div class="status-banner status-marked">
          <div class="lbl">frase ${(game.drawnIndices || []).length} · marcou e agora reza 🙏</div>
          <div class="phrase-display">"${escapeHtml(current.text)}"</div>
          <div class="lbl mt-1">${answeredCount}/${totalPlayers} já responderam · aguarde o Mestre</div>
        </div>
      ` : expired ? `
        <div class="status-banner status-marked" style="border-color: var(--red);">
          <div class="lbl" style="color: var(--red);">⏰ TEMPO ESGOTADO!</div>
          <div class="phrase-display">"${escapeHtml(current.text)}"</div>
          <div class="lbl mt-1">essa passou... fica esperto na próxima</div>
        </div>
      ` : `
        <div class="status-banner status-active">
          <div class="lbl">frase ${(game.drawnIndices || []).length} · ${answeredCount > 0 ? `${answeredCount}/${totalPlayers} já marcaram!` : 'não decepcione o Mestre'}</div>
          <div class="phrase-display">"${escapeHtml(current.text)}"</div>
          <div class="round-timer">
            <div class="round-timer-bar" id="round-timer-bar"></div>
          </div>
          <div class="round-timer-text" id="round-timer-text"></div>
        </div>
      `) : `
        <div class="status-banner status-waiting">
          <div class="main" style="opacity: 0.7;">o Mestre tá decidindo seu destino 🔮</div>
        </div>
      `}
    </div>

    <div class="bingo-card-wrapper">
      <div class="bingo-card">
        <div class="bingo-card-title">
          CARTELA DE ${escapeHtml(player.name).toUpperCase()} · APROVADA PELO MESTRE
        </div>
        <div class="bingo-grid">
          ${player.cardLayout.map((val, idx) => renderCell(val, idx, player.marks, canMark, bd.hint || {}, game.currentSentenceIdx)).join('')}
        </div>
      </div>

      <div class="text-center mt-3">
        ${wins.bingo ? `
          <div class="display" style="font-size: 28px; color: var(--red);">🏆 BINGO! O MESTRE TE APROVA!</div>
        ` : wins.linha ? `
          <div class="display" style="font-size: 22px; color: var(--green);">🎯 LINHA! TÁ INDO BEM!</div>
        ` : `
          <div style="font-size: 13px; color: rgba(26,35,126,0.6);">forme uma linha, coluna ou diagonal de 4 e impressione o Mestre</div>
        `}
      </div>
    </div>
  `;
}

function renderCell(value, idx, playerMarks, canMark, hints, currentSentenceIdx) {
  const marks = marksToArray(playerMarks);
  // ACERTOS são permanentes (cell verde travada)
  const correctMark = marks.find(m => m.cellIdx === idx && m.correct);
  // ERROS só pintam a célula durante a rodada atual; na próxima, somem
  const currentRoundMark = marks.find(m => m.sentenceIdx === currentSentenceIdx && m.cellIdx === idx);
  let className = 'bingo-cell';
  let inner = '';
  let disabled = false;

  if (correctMark) {
    className += ' correct';
    inner = `<div class="mark">✓</div><div class="display">${escapeHtml(value)}</div>`;
    disabled = true;
  } else if (currentRoundMark && !currentRoundMark.correct) {
    className += ' wrong';
    inner = `<div class="mark">✗</div><div class="display">${escapeHtml(value)}</div>`;
    disabled = true;
  } else {
    if (canMark) className += ' tappable';
    else { className += ' idle'; disabled = true; }
    const hint = hints[value];
    inner = `<div class="display">${escapeHtml(value)}</div>${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}`;
  }

  return `<button class="${className}" data-cell-idx="${idx}" ${disabled ? 'disabled' : ''}>${inner}</button>`;
}

// ─── RANKING ────────────────────────────────────────────────────
function renderRanking() {
  const game = state.game;
  const bd = state.bingoData;
  const playersArr = Object.entries(state.players || {}).map(([slug, p]) => ({ slug, ...p }));
  const drawnAt = game?.drawnAt || {};

  const ranked = rankPlayers(playersArr, drawnAt);

  const top3 = ranked.slice(0, 3);
  const isTeacher = state.isTeacher;

  return `
    <div class="ticker"></div>
    <div class="app-header">
      <div>
        <div class="title">🏆 A HIERARQUIA FINAL</div>
        <div class="sub">${escapeHtml(bd?.name || '')} · ${playersArr.length} aluno${playersArr.length === 1 ? '' : 's'} · julgados pelo Mestre</div>
      </div>
      ${isTeacher ? `<button id="btn-exit-teacher" class="btn-link" style="color: var(--yellow);">sair do trono</button>` : `<button id="btn-leave" class="btn-link" style="color: var(--yellow);">sair</button>`}
    </div>

    <div class="podium-screen">
      ${ranked.length === 0 ? `
        <div class="text-center" style="padding: 40px;">
          <div class="display" style="font-size: 24px; color: var(--navy);">ninguém participou. o Mestre está decepcionado.</div>
        </div>
      ` : `
        <div class="podium">
          ${top3[1] ? `
            <div class="podium-spot silver">
              <div class="place">2º</div>
              <div class="name">${escapeHtml(top3[1].name)}</div>
              <div class="pts">${top3[1].correct} ✓ · ${top3[1].wrong} ✗</div>
              ${top3[1].bingo ? '<div style="margin-top: 4px;">🏆</div>' : top3[1].linha ? '<div style="margin-top: 4px;">🎯</div>' : ''}
            </div>
          ` : '<div></div>'}
          ${top3[0] ? `
            <div class="podium-spot gold">
              <div class="place">🏆 1º</div>
              <div class="name">${escapeHtml(top3[0].name)}</div>
              <div class="pts">${top3[0].correct} ✓ · ${top3[0].wrong} ✗</div>
              ${top3[0].avgSec ? `<div style="margin-top: 6px; font-size: 11px; opacity: 0.8;">${top3[0].avgSec.toFixed(1)}s/frase</div>` : ''}
            </div>
          ` : '<div></div>'}
          ${top3[2] ? `
            <div class="podium-spot bronze">
              <div class="place">3º</div>
              <div class="name">${escapeHtml(top3[2].name)}</div>
              <div class="pts">${top3[2].correct} ✓ · ${top3[2].wrong} ✗</div>
              ${top3[2].bingo ? '<div style="margin-top: 4px;">🏆</div>' : top3[2].linha ? '<div style="margin-top: 4px;">🎯</div>' : ''}
            </div>
          ` : '<div></div>'}
        </div>

        <div class="full-ranking">
          <div class="head">CLASSIFICAÇÃO GERAL</div>
          ${ranked.map((p, i) => `
            <div class="rank-row ${p.bingo ? 'has-bingo' : p.linha ? 'has-linha' : ''}">
              <div class="num">${i + 1}º</div>
              <div class="mini-grid">
                ${Array(16).fill('').map((_, j) => {
                  const c = p.grid[j];
                  return `<div class="mini-cell ${c === 'c' ? 'c' : c === 'w' ? 'w' : ''}"></div>`;
                }).join('')}
              </div>
              <div class="name" style="font-family: 'Bricolage Grotesque'; font-weight: 700;">${escapeHtml(p.name)}</div>
              <div class="stats">
                ${p.correct} ✓ · ${p.wrong} ✗
                ${p.avgSec ? ` · ${p.avgSec.toFixed(1)}s méd.` : ''}
                ${p.bingo ? ' · 🏆 BINGO' : p.linha ? ' · 🎯 LINHA' : ''}
              </div>
            </div>
          `).join('')}
        </div>

        ${isTeacher ? `
          <div class="action-row mt-4">
            <button id="btn-print" class="btn btn-primary">🖨️ IMPRIMIR (pro Mestre arquivar)</button>
            <button id="btn-reopen" class="btn btn-outline">↩ REABRIR JOGO</button>
            <button id="btn-new-game" class="btn btn-red">+ NOVO JOGO</button>
          </div>
        ` : `
          <div class="text-center mt-4" style="font-size: 14px; color: rgba(26,35,126,0.7);">
            Obrigado por participar do espetáculo do Mestre! 🎉
          </div>
        `}
      `}
    </div>
  `;
}

// ─── MODAL ──────────────────────────────────────────────────────
function renderModal() {
  const m = state.modal;
  if (!m) return '';

  if (m.type === 'pin') {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal ${state.pinError ? 'shake' : ''}">
          <h2 style="color: var(--red);">🔒 Senha sagrada do Mestre</h2>
          <p>Só verdadeiros mestres (ou plebeus autorizados pelo Mestre Paulo) entram.</p>
          <input type="password" id="input-pin" class="input" placeholder="••••••••" autocomplete="off">
          <div class="modal-buttons mt-3">
            <button id="btn-pin-cancel" class="btn btn-outline">cancelar</button>
            <button id="btn-pin-submit" class="btn btn-red">entrar no trono</button>
          </div>
        </div>
      </div>
    `;
  }

  if (m.type === 'reset') {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal">
          <h2 style="color: var(--red);">Resetar tudo, Mestre?</h2>
          <p>Vai apagar o jogo atual e a galera vai ter que entrar de novo.</p>
          <div class="modal-buttons">
            <button id="btn-reset-cancel" class="btn btn-outline">cancelar</button>
            <button id="btn-reset-confirm" class="btn btn-red">resetar</button>
          </div>
        </div>
      </div>
    `;
  }

  if (m.type === 'end') {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal">
          <h2>Encerrar e revelar a hierarquia?</h2>
          <p>O ranking aparece pra todo mundo. Você pode reabrir depois se quiser.</p>
          <div class="modal-buttons">
            <button id="btn-end-cancel" class="btn btn-outline">cancelar</button>
            <button id="btn-end-confirm" class="btn btn-primary">encerrar</button>
          </div>
        </div>
      </div>
    `;
  }

  if (m.type === 'delete-bingo') {
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal">
          <h2 style="color: var(--red);">Apagar este bingo?</h2>
          <p>O bingo <strong>${escapeHtml(m.name)}</strong> some pra sempre. Sem retorno, nem o Mestre te salva.</p>
          <div class="modal-buttons">
            <button id="btn-delbingo-cancel" class="btn btn-outline">cancelar</button>
            <button id="btn-delbingo-confirm" class="btn btn-red" data-del-confirm="${escapeHtml(m.bingoId)}">apagar</button>
          </div>
        </div>
      </div>
    `;
  }

  if (m.type === 'upload') {
    const preview = state.uploadPreview;
    const errors = state.uploadError;
    return `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" style="max-width: 520px;">
          <h2>Adicionar novo bingo ao arsenal</h2>
          <p>Arraste o arquivo <code>.json</code> ou clique pra selecionar.</p>

          <div class="drop-zone" id="drop-zone">
            <div class="drop-zone-icon">📥</div>
            <div class="drop-zone-text">
              Arraste o arquivo aqui<br>
              <span style="font-size: 12px; opacity: 0.7;">ou</span>
            </div>
            <button id="btn-pick-file" class="btn btn-outline btn-small mt-2">selecionar arquivo</button>
            <input type="file" id="file-input" accept=".json,application/json" style="display: none;">
          </div>

          ${errors ? `
            <div class="upload-errors">
              <strong>Problemas no arquivo:</strong>
              <ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
              <small>Corrija o arquivo e tente de novo, ou peça um novo ao Claude.</small>
            </div>
          ` : ''}

          ${preview ? `
            <div class="upload-preview">
              <div class="up-name">${escapeHtml(preview.name)}</div>
              <div class="up-meta">${preview.sentences.length} frases · 16 categorias na cartela</div>
              ${state.customBingos[preview.id] || state.defaultBingos[preview.id] ? `
                <div class="upload-warning">⚠️ Já existe um bingo com id "<strong>${escapeHtml(preview.id)}</strong>". Vai sobrescrever.</div>
              ` : ''}
            </div>
          ` : ''}

          <div class="modal-buttons mt-3">
            <button id="btn-upload-cancel" class="btn btn-outline">cancelar</button>
            <button id="btn-upload-confirm" class="btn btn-primary" ${preview && !errors ? '' : 'disabled'}>
              ${preview ? 'adicionar ao arsenal' : 'esperando arquivo...'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  return '';
}

function renderCelebrate() {
  const colors = ['#C1272D', '#FFC107', '#1A237E', '#2E7D32', '#FF6F00', '#E91E63'];
  let confetti = '';
  for (let i = 0; i < 60; i++) {
    const left = Math.random() * 100;
    const color = colors[i % colors.length];
    const delay = Math.random() * 1.5;
    const dur = 2.5 + Math.random() * 2;
    confetti += `<div class="confetti-piece" style="left: ${left}%; background-color: ${color}; animation-delay: ${delay}s; animation-duration: ${dur}s;"></div>`;
  }
  return `
    ${confetti}
    <div class="celebrate-overlay">
      <div class="text pop-in">${escapeHtml(state.showCelebrate)}</div>
    </div>
  `;
}

function renderError() {
  return `
    <div class="center-screen">
      <div class="card card-red" style="max-width: 460px;">
        <h2 class="display" style="font-size: 22px; color: var(--red); margin-bottom: 10px;">Algo deu errado</h2>
        <p style="margin-bottom: 14px;">${escapeHtml(state.error || 'Erro desconhecido')}</p>
        <button id="btn-back-home" class="btn btn-primary" style="width: 100%;">voltar ao início</button>
      </div>
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════
//  EVENT HANDLERS
// ════════════════════════════════════════════════════════════════

function attachListeners() {
  // landing
  document.getElementById('btn-join')?.addEventListener('click', handleJoin);
  document.getElementById('btn-teacher')?.addEventListener('click', () => {
    setState({ modal: { type: 'pin' }, pinError: false });
    setTimeout(() => document.getElementById('input-pin')?.focus(), 50);
  });
  document.getElementById('input-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleJoin();
  });

  // teacher: escolha de bingo
  document.querySelectorAll('.bingo-option').forEach(el => {
    el.addEventListener('click', () => handleStartGame(el.dataset.bingoId));
  });
  // teacher: deletar bingo customizado
  document.querySelectorAll('[data-del-bingo]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const id = el.dataset.delBingo;
      const bd = state.customBingos[id];
      if (bd) setState({ modal: { type: 'delete-bingo', bingoId: id, name: bd.name } });
    });
  });
  // teacher: outras ações
  document.getElementById('btn-add-bingo')?.addEventListener('click', () => {
    setState({ modal: { type: 'upload' }, uploadPreview: null, uploadError: null });
  });
  document.getElementById('btn-draw')?.addEventListener('click', handleDraw);
  document.getElementById('btn-scoreboard')?.addEventListener('click', () => setState({ scoreboard: true }));
  document.getElementById('btn-scoreboard-window')?.addEventListener('click', openScoreboardWindow);
  document.getElementById('btn-close-scoreboard')?.addEventListener('click', () => setState({ scoreboard: false }));
  document.getElementById('btn-reveal')?.addEventListener('click', () => setState({ revealAnswer: !state.revealAnswer }));
  document.getElementById('btn-end')?.addEventListener('click', () => setState({ modal: { type: 'end' } }));
  document.getElementById('btn-reset')?.addEventListener('click', () => setState({ modal: { type: 'reset' } }));
  document.getElementById('btn-exit-teacher')?.addEventListener('click', handleExitTeacher);
  document.getElementById('btn-copy-link')?.addEventListener('click', handleCopyLink);
  document.getElementById('btn-print')?.addEventListener('click', () => window.print());
  document.getElementById('btn-reopen')?.addEventListener('click', handleReopen);
  document.getElementById('btn-new-game')?.addEventListener('click', handleNewGame);

  // student
  document.querySelectorAll('[data-cell-idx]').forEach(el => {
    el.addEventListener('click', () => handleCellTap(parseInt(el.dataset.cellIdx)));
  });
  document.getElementById('btn-leave')?.addEventListener('click', handleLeave);

  // modal: pin
  document.getElementById('btn-pin-cancel')?.addEventListener('click', () => setState({ modal: null }));
  document.getElementById('btn-pin-submit')?.addEventListener('click', handlePinSubmit);
  document.getElementById('input-pin')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handlePinSubmit();
  });

  // modal: reset/end
  document.getElementById('btn-reset-cancel')?.addEventListener('click', () => setState({ modal: null }));
  document.getElementById('btn-reset-confirm')?.addEventListener('click', handleResetConfirm);
  document.getElementById('btn-end-cancel')?.addEventListener('click', () => setState({ modal: null }));
  document.getElementById('btn-end-confirm')?.addEventListener('click', handleEndConfirm);

  // modal: delete bingo
  document.getElementById('btn-delbingo-cancel')?.addEventListener('click', () => setState({ modal: null }));
  document.querySelectorAll('[data-del-confirm]').forEach(el => {
    el.addEventListener('click', () => handleDeleteBingo(el.dataset.delConfirm));
  });

  // modal: upload
  document.getElementById('btn-upload-cancel')?.addEventListener('click', () => {
    setState({ modal: null, uploadPreview: null, uploadError: null });
  });
  document.getElementById('btn-upload-confirm')?.addEventListener('click', handleUploadConfirm);
  document.getElementById('btn-pick-file')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
  document.getElementById('file-input')?.addEventListener('change', e => {
    handleFileSelected(e.target.files[0]);
  });
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    ['dragover', 'dragenter'].forEach(ev => dropZone.addEventListener(ev, e => {
      e.preventDefault(); dropZone.classList.add('dragging');
    }));
    ['dragleave', 'dragend'].forEach(ev => dropZone.addEventListener(ev, e => {
      dropZone.classList.remove('dragging');
    }));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelected(file);
    });
  }

  // error screen
  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    clearListeners();
    clearSession();
    setState({ view: 'landing', error: null, player: null, game: null });
  });
}

// ─── Ações ────────────────────────────────────────────────────

async function handleJoin() {
  const nameInput = document.getElementById('input-name');
  const name = (nameInput?.value || '').trim();
  if (name.length < 2) {
    setState({ joinError: 'Digite seu nome (mínimo 2 letras).' });
    return;
  }

  const game = await dbGetGame();

  // garante listeners ativos para detectar quando jogo iniciar
  if (!state.unsub.game) attachGameListener();
  if (!state.unsub.players) attachPlayersListener();

  if (!game) {
    // Sem jogo ainda — fica aguardando
    saveSession({ role: 'student', name });
    state.lastWins = { linha: false, bingo: false };
    state.pendingJoinName = name;
    setState({
      view: 'student',
      player: { name, slug: null, cardLayout: [], marks: {} },
      joinError: null
    });
    return;
  }

  if (game.phase === 'ended') {
    setState({ joinError: 'O jogo já terminou. Espere o professor iniciar outro.' });
    return;
  }

  const bd = getBingo(game.gameType);
  if (!bd) {
    setState({ joinError: 'Erro: não encontrei o bingo deste jogo.' });
    return;
  }

  const result = await dbJoinAsPlayer(name);
  if (result.error) {
    setState({ joinError: 'Erro ao entrar. Tente novamente.' });
    return;
  }
  saveSession({ role: 'student', slug: result.slug, name, gameCreatedAt: game.createdAt });
  state.lastWins = { linha: false, bingo: false };
  setState({
    view: 'student',
    player: result.player,
    bingoData: bd,
    game,
    joinError: null
  });
}

async function handlePinSubmit() {
  const pin = document.getElementById('input-pin')?.value || '';
  if (pin !== TEACHER_PIN) {
    setState({ pinError: true });
    setTimeout(() => setState({ pinError: false }), 500);
    return;
  }
  saveSession({ role: 'teacher' });
  if (!state.unsub.game) attachGameListener();
  if (!state.unsub.players) attachPlayersListener();
  const game = await dbGetGame();
  const players = await dbGetPlayers();
  if (game?.gameType) {
    const bd = getBingo(game.gameType);
    setState({ isTeacher: true, modal: null, view: 'teacher', game, players, bingoData: bd });
  } else {
    setState({ isTeacher: true, modal: null, view: 'teacher', game: null, players });
  }
}

async function handleStartGame(bingoId) {
  const bd = getBingo(bingoId);
  if (!bd) { alert('Bingo não encontrado'); return; }
  await dbStartGame(bingoId);
  setState({ bingoData: bd });
}

async function handleDraw() {
  if (!state.bingoData) return;
  state.revealAnswer = false; // nova frase volta a esconder a resposta
  await dbDrawNext(state.bingoData.sentences.length);
}

// Abre o placar numa janela separada, tentando posicioná-la
// automaticamente num segundo monitor (projetor). Se o navegador
// não suportar, abre janela normal pra você arrastar.
async function openScoreboardWindow() {
  const url = location.origin + location.pathname + '?placar=1';

  // tenta usar a Window Management API (Chrome/Edge) pra achar o 2º monitor
  try {
    if ('getScreenDetails' in window) {
      const details = await window.getScreenDetails();
      const external = details.screens.find(s => !s.isCurrent) || details.screens.find(s => s !== details.currentScreen);
      if (external) {
        const feat = `left=${external.availLeft},top=${external.availTop},width=${external.availWidth},height=${external.availHeight}`;
        const win = window.open(url, 'placar_bingo', feat);
        if (win) {
          // garante tela cheia no monitor externo
          setTimeout(() => { try { win.moveTo(external.availLeft, external.availTop); win.resizeTo(external.availWidth, external.availHeight); } catch {} }, 300);
          return;
        }
      }
    }
  } catch (e) {
    // permissão negada ou API indisponível → cai no fallback
  }

  // fallback: janela grande comum (você arrasta pro projetor e dá F11)
  const w = Math.min(screen.availWidth, 1280);
  const h = Math.min(screen.availHeight, 800);
  window.open(url, 'placar_bingo', `width=${w},height=${h},left=120,top=80`);
}

async function handleEndConfirm() {
  setState({ modal: null });
  await dbEndGame();
}

async function handleReopen() {
  await dbReopenGame();
}

async function handleNewGame() {
  await dbResetEverything();
  setState({ game: null, bingoData: null, players: {} });
}

async function handleResetConfirm() {
  setState({ modal: null });
  await dbResetEverything();
  if (state.isTeacher) {
    setState({ game: null, bingoData: null, players: {} });
  } else {
    clearSession();
    setState({ view: 'landing', player: null });
  }
}

async function handleCellTap(cellIdx) {
  if (!state.player?.slug || !state.game || !state.bingoData) return;
  const game = state.game;
  if (game.currentSentenceIdx < 0) return;
  // trava de tempo: estourou os segundos da rodada, não marca mais
  const drawnTs = (game.drawnAt || {})[game.currentSentenceIdx];
  if (drawnTs && (Date.now() - drawnTs) / 1000 >= ROUND_SECONDS) return;
  const marks = marksToArray(state.player.marks);
  // bloqueia se já marcou algo nesta rodada
  if (marks.some(m => m.sentenceIdx === game.currentSentenceIdx)) return;
  // bloqueia se essa célula já foi acertada antes
  if (marks.some(m => m.cellIdx === cellIdx && m.correct)) return;
  const sentence = state.bingoData.sentences[game.currentSentenceIdx];
  const cellValue = state.player.cardLayout[cellIdx];
  const correct = cellValue === sentence.answer;
  if (correct) soundCorrect(); else soundWrong();
  await dbMarkCell(state.player.slug, game.currentSentenceIdx, cellIdx, correct);
}

async function handleLeave() {
  if (state.player?.slug) {
    try { await remove(ref(db, `players/${state.player.slug}`)); } catch {}
  }
  clearSession();
  clearListeners();
  setState({
    view: 'landing', player: null, game: null,
    bingoData: null, lastWins: { linha: false, bingo: false },
    pendingJoinName: null
  });
}

function handleExitTeacher() {
  clearSession();
  clearListeners();
  setState({
    view: 'landing', isTeacher: false, game: null,
    players: {}, bingoData: null
  });
}

async function handleCopyLink() {
  const url = location.origin + location.pathname;
  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('btn-copy-link');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'copiado!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }
  } catch {
    prompt('Copie o link:', url);
  }
}

async function handleDeleteBingo(id) {
  await dbDeleteCustomBingo(id);
  setState({ modal: null });
}

function handleFileSelected(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json')) {
    setState({ uploadError: ['O arquivo precisa ser .json'], uploadPreview: null });
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const text = ev.target.result;
      const data = JSON.parse(text);
      const errors = validateBingoData(data);
      if (errors.length) {
        setState({ uploadError: errors, uploadPreview: null });
      } else {
        setState({ uploadError: null, uploadPreview: data });
      }
    } catch (e) {
      setState({
        uploadError: [`Não consegui ler o JSON: ${e.message}.`],
        uploadPreview: null
      });
    }
  };
  reader.onerror = () => setState({ uploadError: ['Erro ao ler o arquivo.'], uploadPreview: null });
  reader.readAsText(file);
}

async function handleUploadConfirm() {
  const data = state.uploadPreview;
  if (!data) return;
  await dbUploadCustomBingo(data);
  setState({ modal: null, uploadPreview: null, uploadError: null });
}

// ════════════════════════════════════════════════════════════════
//  INICIALIZAÇÃO
// ════════════════════════════════════════════════════════════════

(async function init() {
  try {
    if (!firebaseConfig.databaseURL || firebaseConfig.databaseURL.includes('seu-projeto')) {
      setState({
        view: 'error',
        error: 'Firebase não configurado. Edite o arquivo firebase-config.js com as chaves do seu projeto. Veja o README.md.'
      });
      return;
    }

    state.defaultBingos = await loadDefaultBingos();
    attachCustomBingosListener();

    // pequeno delay pra customs carregarem do Firebase antes da primeira tela
    await new Promise(r => setTimeout(r, 400));

    // modo janela de placar (?placar=1): só escuta e mostra o placar
    const params = new URLSearchParams(location.search);
    if (params.get('placar') === '1') {
      attachGameListener();
      attachPlayersListener();
      const game = await dbGetGame();
      const players = await dbGetPlayers();
      const bd = game?.gameType ? getBingo(game.gameType) : null;
      setState({ standaloneScoreboard: true, game, players, bingoData: bd });
      document.title = 'Placar ao vivo · Bingo';
      return;
    }

    const sess = loadSession();
    if (sess?.role === 'teacher') {
      attachGameListener();
      attachPlayersListener();
      const game = await dbGetGame();
      const players = await dbGetPlayers();
      if (game?.gameType) {
        const bd = getBingo(game.gameType);
        setState({ isTeacher: true, view: 'teacher', game, players, bingoData: bd });
      } else {
        setState({ isTeacher: true, view: 'teacher', game: null, players });
      }
      return;
    }
    if (sess?.role === 'student' && sess.name) {
      const game = await dbGetGame();
      const players = await dbGetPlayers();

      // A sessão só vale DENTRO do mesmo jogo: o aluno precisa ainda estar
      // registrado E o jogo precisa ser o mesmo de quando ele entrou
      // (createdAt igual). Jogo novo ou reset → tela de nome limpa.
      const sameGame = game && sess.gameCreatedAt && game.createdAt === sess.gameCreatedAt;
      if (sameGame && sess.slug && players[sess.slug]) {
        attachGameListener();
        attachPlayersListener();
        const bd = getBingo(game.gameType);
        setState({
          view: 'student',
          player: { slug: sess.slug, ...players[sess.slug] },
          game, bingoData: bd
        });
        return;
      }
      // sessão velha (outra turma, outro jogo, reset) → limpa e pede nome
      clearSession();
      setState({ view: 'landing' });
      return;
    }

    setState({ view: 'landing' });
  } catch (e) {
    console.error('Falha na inicialização:', e);
    setState({
      view: 'error',
      error: `Falha ao inicializar: ${e.message}.`
    });
  }
})();
