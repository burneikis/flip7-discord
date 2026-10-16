import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Game } from '../shared/engine';
import { botDecision } from '../shared/bot';
import { cardKey, ALL_CARD_KEYS } from '../shared/cards';
import type { ClientMessage, GameView, RoomView, ServerMessage } from '../shared/protocol';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // no .env: fine for browser-only testing
}

const PORT = Number(process.env.PORT ?? 3001);
const DISCORD_CLIENT_ID = process.env.VITE_DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DEV = process.env.DEV === '1';
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 900);
/** How long a disconnected player's decisions wait before a bot plays for them. */
const OFFLINE_GRACE_MS = Number(process.env.OFFLINE_GRACE_MS ?? 15_000);
const MAX_PLAYERS = 18;
const DIST = path.resolve(import.meta.dirname, '../../dist');
const BOT_NAMES = ['Ada', 'Bix', 'Cog', 'Dot', 'Echo', 'Fizz', 'Gizmo', 'Hex', 'Ion', 'Jinx', 'Kilo', 'Lux'];

interface Member { id: string; name: string; isBot: boolean }

class Room {
  members: Member[] = [];
  hostId: string | null = null;
  brutal = false;
  target = 200;
  game: Game | null = null;
  sockets = new Map<WebSocket, string>();
  offlineSince = new Map<string, number>();
  timer: NodeJS.Timeout | null = null;

  constructor(readonly id: string) {}

  isConnected(pid: string) {
    for (const id of this.sockets.values()) if (id === pid) return true;
    return false;
  }

  ensureHost() {
    if (this.hostId && this.isConnected(this.hostId)) return;
    const next = this.members.find((m) => !m.isBot && this.isConnected(m.id));
    if (next) this.hostId = next.id;
  }

  roomView(): RoomView {
    return {
      id: this.id,
      hostId: this.hostId,
      brutal: this.brutal,
      target: this.target,
      members: this.members.map((m) => ({ ...m, connected: m.isBot || this.isConnected(m.id) })),
    };
  }

  gameView(): GameView | null {
    const g = this.game;
    if (!g) return null;
    return {
      phase: g.phase,
      round: g.round,
      dealerId: g.players[g.dealer].id,
      turnId: g.currentTurnId,
      players: g.players.map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        connected: p.isBot || this.isConnected(p.id),
        line: p.line,
        status: p.status,
        total: p.total,
        live: g.liveScore(p),
        lastRound: p.lastRound,
      })),
      deckCount: g.deck.length,
      discardCount: g.discardPile.length,
      prompt: g.prompt,
      log: g.log.slice(-80),
      flip7By: g.flip7By,
      winners: g.winners,
      options: g.options,
    };
  }

  broadcast() {
    const room = this.roomView();
    const game = this.gameView();
    for (const [ws, pid] of this.sockets) {
      send(ws, { type: 'state', you: pid, devMode: DEV, room, game });
    }
    this.scheduleAutomation();
  }

  /** Bots act after a short delay; offline humans get a bot after a grace period. */
  scheduleAutomation() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const g = this.game;
    if (!g || g.phase !== 'playing' || !g.prompt) return;
    const prompt = g.prompt;
    const pid = prompt.playerId;
    let delay: number;
    if (g.player(pid).isBot) delay = BOT_DELAY_MS;
    else if (!this.isConnected(pid)) {
      const since = this.offlineSince.get(pid) ?? Date.now();
      delay = Math.max(BOT_DELAY_MS, OFFLINE_GRACE_MS - (Date.now() - since));
    } else return;
    this.timer = setTimeout(() => {
      if (this.game !== g || g.prompt !== prompt) return;
      const err = g.decide(pid, botDecision(g, pid));
      if (err) console.error(`[${this.id}] bot decision rejected: ${err}`);
      this.broadcast();
    }, delay);
  }
}

const rooms = new Map<string, Room>();

// ------------------------------------------------------------------ discord

/** Exchange the OAuth code from the Embedded App SDK for an access token. */
async function exchangeCode(code: string): Promise<{ status: number; body: unknown }> {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return { status: 500, body: { error: 'Server is missing VITE_DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env' } };
  }
  const res = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
    }),
  });
  const data = (await res.json()) as { access_token?: string };
  if (!res.ok || !data.access_token) {
    console.error('Discord token exchange failed', res.status, data);
    return { status: 502, body: { error: 'Discord token exchange failed' } };
  }
  return { status: 200, body: { access_token: data.access_token } };
}

const verifiedTokens = new Map<string, { id: string; name: string }>();

/** Ask Discord who owns this token, so players can't pretend to be each other. */
async function verifyDiscordUser(token: string): Promise<{ id: string; name: string } | null> {
  const cached = verifiedTokens.get(token);
  if (cached) return cached;
  const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const u = (await res.json()) as { id: string; username: string; global_name?: string | null };
  const user = { id: `discord-${u.id}`, name: u.global_name || u.username };
  verifiedTokens.set(token, user);
  return user;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(ws: WebSocket, msg: ClientMessage, ctx: { room: Room | null }): string | null {
  if (msg.type === 'join') {
    const roomId = String(msg.roomId || 'main').slice(0, 64);
    const pid = String(msg.playerId).slice(0, 64);
    const name = String(msg.name || 'Player').trim().slice(0, 24) || 'Player';
    let room = rooms.get(roomId);
    if (!room) rooms.set(roomId, (room = new Room(roomId)));
    ctx.room?.sockets.delete(ws);
    ctx.room = room;
    room.sockets.set(ws, pid);
    room.offlineSince.delete(pid);
    const existing = room.members.find((m) => m.id === pid);
    if (existing) existing.name = room.game?.players.some((p) => p.id === pid) ? existing.name : name;
    else room.members.push({ id: pid, name, isBot: false });
    room.ensureHost();
    return null;
  }

  const room = ctx.room;
  if (!room) return 'Join a room first';
  const pid = room.sockets.get(ws)!;
  const isHost = room.hostId === pid;
  const inLobby = !room.game;

  switch (msg.type) {
    case 'addBot': {
      if (!isHost || !inLobby) return 'Only the host can add bots in the lobby';
      if (room.members.length >= MAX_PLAYERS) return 'Table is full';
      const used = new Set(room.members.map((m) => m.name));
      const name = `Bot ${BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? room.members.length}`;
      room.members.push({ id: `bot-${Math.random().toString(36).slice(2, 8)}`, name, isBot: true });
      return null;
    }
    case 'kick': {
      if (!isHost || !inLobby) return 'Only the host can remove players in the lobby';
      room.members = room.members.filter((m) => m.id !== msg.playerId);
      return null;
    }
    case 'setOptions': {
      if (!isHost || !inLobby) return 'Only the host can change options';
      if (typeof msg.brutal === 'boolean') room.brutal = msg.brutal;
      if (typeof msg.target === 'number' && msg.target >= 25 && msg.target <= 1000) room.target = Math.round(msg.target);
      return null;
    }
    case 'start': {
      if (!isHost || !inLobby) return 'Only the host can start';
      const seated = room.members.slice(0, MAX_PLAYERS);
      if (seated.length < 2) return 'Need at least 2 players (add a bot?)';
      room.game = new Game(seated, { brutal: room.brutal, target: room.target });
      return null;
    }
    case 'decide': {
      if (!room.game) return 'No game running';
      return room.game.decide(pid, msg.decision);
    }
    case 'nextRound': {
      if (!room.game) return 'No game running';
      if (!room.game.players.some((p) => p.id === pid)) return 'Spectators cannot advance rounds';
      return room.game.nextRound();
    }
    case 'endGame': {
      if (!isHost) return 'Only the host can end the game';
      room.game = null;
      room.members = room.members.filter((m) => m.isBot || room.isConnected(m.id));
      return null;
    }
    case 'rig': {
      if (!DEV) return 'Rigging is only available in dev mode';
      if (!room.game) return 'No game running';
      if (!ALL_CARD_KEYS.includes(msg.key)) return 'Unknown card';
      return room.game.rigTopCard((c) => cardKey(c) === msg.key) ? null : 'That card is not available';
    }
    default:
      return 'Unknown message';
  }
}

// ------------------------------------------------------------------ http

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/api/token' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      let result: { status: number; body: unknown };
      try {
        const { code } = JSON.parse(raw) as { code?: string };
        result = code ? await exchangeCode(code) : { status: 400, body: { error: 'Missing code' } };
      } catch (e) {
        console.error(e);
        result = { status: 500, body: { error: 'Token exchange error' } };
      }
      res.writeHead(result.status, { 'content-type': 'application/json' }).end(JSON.stringify(result.body));
    });
    return;
  }
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) return void res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Client not built. Run `npm run build`, or use `npm run dev`.');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const ctx: { room: Room | null } = { room: null };
  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(ws, { type: 'error', message: 'Bad message' });
    }
    if (msg.type === 'join' && msg.accessToken) {
      const user = await verifyDiscordUser(msg.accessToken).catch(() => null);
      if (!user) return send(ws, { type: 'error', message: 'Could not verify your Discord account' });
      msg = { ...msg, playerId: user.id, name: user.name };
    }
    let err: string | null;
    try {
      err = handle(ws, msg, ctx);
    } catch (e) {
      console.error(e);
      err = 'Server error: ' + (e as Error).message;
    }
    if (err) send(ws, { type: 'error', message: err });
    ctx.room?.broadcast();
  });
  ws.on('close', () => {
    const room = ctx.room;
    if (!room) return;
    const pid = room.sockets.get(ws);
    room.sockets.delete(ws);
    if (pid && !room.isConnected(pid)) {
      room.offlineSince.set(pid, Date.now());
      if (!room.game) room.members = room.members.filter((m) => m.id !== pid);
    }
    room.ensureHost();
    if (room.sockets.size === 0 && !room.members.some((m) => !m.isBot)) rooms.delete(room.id);
    room.broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`Flip 7 server on http://localhost:${PORT}${DEV ? ' (dev mode: deck rigging enabled)' : ''}`);
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) console.log('Discord credentials not set in .env (browser play still works)');
});
