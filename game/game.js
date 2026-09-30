// A throwaway "game": a ship drifting through a starfield among enemies, plus four buttons that break it
// in the four ways the SDK knows how to catch.
'use strict';

const API = `${location.protocol}//${location.hostname}:5080`;
const DASHBOARD = `${location.protocol}//${location.hostname}:5173`;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const state = {
  level: 1,
  fps: 60,
  time: 0,
  ship: { x: 360, y: 200 },
  enemies: [],
  stars: Array.from({ length: 90 }, () => ({ x: Math.random() * 720, y: Math.random() * 400, speed: 0.3 + Math.random() * 1.7 })),
  pendingHit: false,
};

Pulse.init({
  endpoint: `${API}/api/events`,
  release: '1.0.3',
  getContext: () => ({ level: state.level, fps: state.fps }),
});

function spawnEnemies() {
  state.enemies = Array.from({ length: 2 + state.level }, (_, i) => ({ angle: (i / (2 + state.level)) * Math.PI * 2, radius: 120 + (i % 3) * 30, hp: 100 }));
}

// Button 1 sets a flag; the next frame then "hits" an enemy index that doesn't exist.
// That throws inside the game loop: TypeError: Cannot read properties of undefined (reading 'hp').
function applyDamage(enemy, damage) {
  enemy.hp -= damage;
}

let lastFrame = performance.now();
function tick(now) {
  requestAnimationFrame(tick); // schedule first, so a crash in this frame doesn't stop the game
  const dt = Math.min(now - lastFrame, 50);
  lastFrame = now;
  state.fps = Math.round(0.9 * state.fps + 0.1 * (1000 / Math.max(dt, 1)));
  state.time += dt;

  const nextLevel = 1 + Math.floor(state.time / 15000);
  if (nextLevel !== state.level) { state.level = nextLevel; spawnEnemies(); }

  update(dt);
  draw();

  if (state.pendingHit) {
    state.pendingHit = false;
    applyDamage(state.enemies[state.enemies.length + 2], 10);
  }
}

function update(dt) {
  const t = state.time / 1000;
  state.ship.x = 360 + Math.sin(t * 0.9) * 220;
  state.ship.y = 200 + Math.sin(t * 1.7) * 110;
  for (const star of state.stars) {
    star.x -= star.speed * dt * 0.06;
    if (star.x < 0) { star.x = 720; star.y = Math.random() * 400; }
  }
  for (const enemy of state.enemies) enemy.angle += dt * 0.0006 * (1 + state.level * 0.15);
}

function draw() {
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, 720, 400);

  for (const star of state.stars) {
    ctx.fillStyle = `rgba(200, 215, 255, ${star.speed / 2})`;
    ctx.fillRect(star.x, star.y, star.speed, star.speed);
  }

  for (const enemy of state.enemies) {
    const x = 360 + Math.cos(enemy.angle) * enemy.radius * 1.6;
    const y = 200 + Math.sin(enemy.angle) * enemy.radius * 0.8;
    ctx.fillStyle = '#f0506e';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#34d399';
    ctx.fillRect(x - 12, y - 20, 24 * (enemy.hp / 100), 3);
  }

  const { x, y } = state.ship;
  ctx.fillStyle = '#7dd3fc';
  ctx.beginPath();
  ctx.moveTo(x + 16, y);
  ctx.lineTo(x - 10, y - 10);
  ctx.lineTo(x - 5, y);
  ctx.lineTo(x - 10, y + 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '13px ui-monospace, monospace';
  ctx.fillText(`LEVEL ${state.level}   FPS ${state.fps}`, 14, 24);
}

// Button 2: an async call nobody awaits or catches -> unhandledrejection.
async function loadPlayerProfile(playerId) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  throw new Error(`Player ${playerId} not found`);
}

// Button 3: the leaderboard endpoint doesn't exist -> 404. The game copes; the SDK still reports it.
async function loadLeaderboard() {
  const res = await fetch(`/api/leaderboard?season=${state.level}`);
  return res.ok ? res.json() : [];
}

// Button 4: 200 uncaught errors in one second, each with a different number in its message.
function errorStorm() {
  for (let i = 0; i < 200; i++) {
    setTimeout(function spawnParticle() {
      throw new RangeError(`Particle ${i} escaped the arena`);
    }, i * 5);
  }
}

const actions = {
  'null-ref': () => { state.pendingHit = true; },
  rejection: () => { loadPlayerProfile(1000 + Math.floor(Math.random() * 9000)); },
  fetch: () => { loadLeaderboard(); },
  storm: errorStorm,
};

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => actions[button.dataset.action]());
});

document.getElementById('dedupe').addEventListener('change', (e) => Pulse.setDedupe(e.target.checked));
document.getElementById('dashboard-link').href = DASHBOARD;
document.getElementById('session').textContent = Pulse.sessionId;

const statEls = Object.fromEntries([...document.querySelectorAll('[data-stat]')].map((el) => [el.dataset.stat, el]));
setInterval(() => {
  for (const [key, el] of Object.entries(statEls)) el.textContent = Pulse.stats[key];
}, 200);

spawnEnemies();
requestAnimationFrame(tick);
