import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { BotAIController } from './src/shared/botAI.ts';
import { ensureRapierReady, PhysicsSimulation } from './src/shared/physicsEngine.ts';
import {
  ACCESSORY_CATALOG,
  ARENA_CATALOG,
  AVATAR_CATALOG,
  BOOST_TRAIL_CATALOG,
  CAR_CATALOG,
  normalizeBotDifficulty,
  PAINT_FINISH_CATALOG,
  WHEEL_STYLE_CATALOG,
} from './src/shared/constants.ts';
import type {
  AccessoryId,
  ArenaId,
  AvatarId,
  BoostTrailId,
  BotDifficulty,
  CarCustomization,
  CarId,
  MatchEvent,
  MatchPhase,
  PaintFinish,
  PartyGameMode,
  PlayerInput,
  RoomPlayerInfo,
  RoomState,
  Team,
  WheelStyleId,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const MAX_PARTY_PLAYERS = 3;

const VALID_CARS = new Set<string>(CAR_CATALOG.map((c) => c.id));
const VALID_ARENAS = new Set<string>(ARENA_CATALOG.map((a) => a.id));
const VALID_TRAILS = new Set<string>(BOOST_TRAIL_CATALOG.map((t) => t.id));
const VALID_ACCESSORIES = new Set<string>(ACCESSORY_CATALOG.map((a) => a.id));
const VALID_AVATARS = new Set<string>(AVATAR_CATALOG.map((a) => a.id));
const VALID_FINISHES = new Set<string>(PAINT_FINISH_CATALOG.map((f) => f.id));
const VALID_WHEELS = new Set<string>(WHEEL_STYLE_CATALOG.map((w) => w.id));
const VALID_MODES = new Set<PartyGameMode>(['ffa', 'team_2v1', 'coop_3v3']);
const VALID_DIFFICULTIES = new Set<BotDifficulty>([
  'rookie',
  'pro',
  'all_star',
  'legend',
]);

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[^\w\s\-_.]/g, '').trim().slice(0, 18);
  return cleaned || fallback;
}

function sanitizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return raw;
  }
  return fallback;
}

function sanitizeAvatar(raw: unknown, fallback: AvatarId = 'striker_helm'): AvatarId {
  return VALID_AVATARS.has(String(raw)) ? (raw as AvatarId) : fallback;
}

function sanitizeCustomization(raw: unknown): CarCustomization {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const carId: CarId = VALID_CARS.has(String(obj.carId)) ? (obj.carId as CarId) : 'striker';
  const boostTrail: BoostTrailId = VALID_TRAILS.has(String(obj.boostTrail))
    ? (obj.boostTrail as BoostTrailId)
    : 'plasma_cyan';
  const accessory: AccessoryId = VALID_ACCESSORIES.has(String(obj.accessory))
    ? (obj.accessory as AccessoryId)
    : 'none';
  const paintFinish: PaintFinish = VALID_FINISHES.has(String(obj.paintFinish))
    ? (obj.paintFinish as PaintFinish)
    : 'metallic';
  const wheelStyle: WheelStyleId = VALID_WHEELS.has(String(obj.wheelStyle))
    ? (obj.wheelStyle as WheelStyleId)
    : 'sport_5';
  const teamAccent =
    typeof obj.teamAccent === 'string' && /^#[0-9A-Fa-f]{6}$/.test(obj.teamAccent)
      ? obj.teamAccent
      : undefined;
  return {
    carId,
    primaryColor: sanitizeHexColor(obj.primaryColor, '#06B6D4'),
    secondaryColor: sanitizeHexColor(obj.secondaryColor, '#F8FAFC'),
    paintFinish,
    wheelStyle,
    teamAccent,
    boostTrail,
    accessory,
  };
}

function clamp(n: unknown, min: number, max: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(min, Math.min(max, v));
}

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

interface ServerPlayer {
  id: string;
  token: string;
  slotIndex: number;
  name: string;
  avatarId: AvatarId;
  team: Team;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
  voiceActive: boolean;
  voiceMuted: boolean;
  customization: CarCustomization;
  ws: WebSocket | null;
  lastSeen: number;
}

interface RoomInstance {
  code: string;
  arenaId: ArenaId;
  matchDuration: number;
  gameMode: PartyGameMode;
  botDifficulty: BotDifficulty;
  maxPlayers: number;
  phase: MatchPhase;
  players: Map<string, ServerPlayer>;
  botControllers: Map<string, BotAIController>;
  sim: PhysicsSimulation | null;
  lastTickTime: number;
  snapshotCounter: number;
  createdAt: number;
}

const rooms = new Map<string, RoomInstance>();
const socketSession = new WeakMap<WebSocket, { roomCode: string; playerId: string }>();

function sendJson(ws: WebSocket | null, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getNextAvailableSlot(room: RoomInstance): number {
  const used = new Set(Array.from(room.players.values()).map((p) => p.slotIndex));
  for (let i = 0; i < room.maxPlayers; i++) {
    if (!used.has(i)) return i;
  }
  return room.players.size;
}

function assignTeamForJoiningPlayer(room: RoomInstance): Team {
  const list = Array.from(room.players.values());
  if (room.gameMode === 'coop_3v3') {
    return 'blue';
  }
  if (room.gameMode === 'ffa') {
    const used = new Set(list.map((p) => p.team));
    if (!used.has('blue')) return 'blue';
    if (!used.has('orange')) return 'orange';
    return 'emerald';
  }
  // team_2v1: aim for 2 on blue, 1 on orange
  const blueCount = list.filter((p) => p.team === 'blue').length;
  const orangeCount = list.filter((p) => p.team === 'orange').length;
  if (orangeCount === 0) return 'orange';
  if (blueCount < 2) return 'blue';
  return orangeCount <= blueCount ? 'orange' : 'blue';
}

function reconcileTeamsForMode(room: RoomInstance): void {
  const sorted = Array.from(room.players.values()).sort((a, b) => a.slotIndex - b.slotIndex);
  if (room.gameMode === 'ffa') {
    const ffaTeams: Team[] = ['blue', 'orange', 'emerald'];
    sorted.forEach((p, idx) => {
      p.team = ffaTeams[idx % ffaTeams.length];
    });
  } else if (room.gameMode === 'coop_3v3') {
    sorted.forEach((p) => {
      p.team = 'blue';
    });
  } else {
    // team_2v1: ensure nobody stays on 'emerald'
    sorted.forEach((p) => {
      if (p.team === 'emerald') {
        const orangeCount = sorted.filter((o) => o.team === 'orange').length;
        p.team = orangeCount === 0 ? 'orange' : 'blue';
      }
    });
  }
}

function getRoomState(room: RoomInstance): RoomState {
  const players: RoomPlayerInfo[] = Array.from(room.players.values())
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((p) => ({
      id: p.id,
      slotIndex: p.slotIndex,
      name: p.name,
      avatarId: p.avatarId,
      team: p.team,
      isHost: p.isHost,
      ready: p.ready,
      connected: p.connected,
      voiceActive: p.voiceActive,
      voiceMuted: p.voiceMuted,
      customization: p.customization,
    }));
  return {
    code: room.code,
    arenaId: room.arenaId,
    matchDuration: room.matchDuration,
    gameMode: room.gameMode,
    botDifficulty: room.botDifficulty,
    maxPlayers: room.maxPlayers,
    phase: room.sim ? room.sim.phase : room.phase,
    players,
  };
}

function broadcastRoomState(room: RoomInstance): void {
  const state = getRoomState(room);
  for (const p of room.players.values()) {
    sendJson(p.ws, { type: 'room:state', room: state });
  }
}

function broadcastMatchEvents(room: RoomInstance, events: MatchEvent[]): void {
  if (events.length === 0) return;
  for (const p of room.players.values()) {
    sendJson(p.ws, { type: 'match:events', events });
  }
}

function startRoomSimulation(room: RoomInstance): void {
  if (room.sim) {
    room.sim.dispose();
  }
  room.botControllers.clear();
  reconcileTeamsForMode(room);

  const sim = new PhysicsSimulation({
    arenaId: room.arenaId,
    matchDuration: room.matchDuration,
    gameMode: room.gameMode,
    isPractice: false,
  });

  const sortedPlayers = Array.from(room.players.values()).sort((a, b) => a.slotIndex - b.slotIndex);
  const teams: Team[] = ['blue', 'orange', 'emerald'];
  for (const team of teams) {
    const members = sortedPlayers.filter((p) => p.team === team);
    members.forEach((p, idx) => {
      sim.addCar(
        {
          id: p.id,
          name: p.name,
          team,
          isBot: false,
          customization: p.customization,
          connected: p.connected,
        },
        idx,
        members.length
      );
    });
  }

  // Co-Op Mode: all party humans on Blue vs 3 AI Bots on Orange
  if (room.gameMode === 'coop_3v3') {
    const botNames = ['Vortex', 'Cobalt', 'Nova'];
    const botCarPool = CAR_CATALOG;
    for (let i = 0; i < 3; i++) {
      const botId = `coop_bot_orange_${i}`;
      const def = botCarPool[(i * 3 + 1) % botCarPool.length];
      sim.addCar(
        {
          id: botId,
          name: `${botNames[i]} (AI)`,
          team: 'orange',
          isBot: true,
          botDifficulty: room.botDifficulty,
          customization: {
            carId: def.id,
            primaryColor: '#F97316',
            secondaryColor: '#1E293B',
            boostTrail: 'solar_flare',
            accessory: i === 0 ? 'shark_fin' : 'none',
          },
          connected: true,
        },
        i,
        3
      );
      room.botControllers.set(botId, new BotAIController());
    }
  }

  sim.resetKickoff(false);
  room.sim = sim;
  room.phase = sim.phase;
  room.lastTickTime = Date.now();
  room.snapshotCounter = 0;

  broadcastRoomState(room);
  const snapshot = sim.getSnapshot();
  for (const p of room.players.values()) {
    sendJson(p.ws, { type: 'match:snapshot', snapshot });
  }
}

// Authoritative 60Hz simulation loop & 30Hz network broadcast
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Cleanup abandoned rooms older than 5 minutes with zero connected players
    const anyConnected = Array.from(room.players.values()).some((p) => p.connected);
    if (!anyConnected && now - room.lastTickTime > 5 * 60 * 1000) {
      room.sim?.dispose();
      room.botControllers.clear();
      rooms.delete(code);
      continue;
    }

    if (!room.sim) continue;

    // Drive authoritative AI bots in Co-Op 3vAI mode
    if (room.botControllers.size > 0 && room.sim.phase === 'playing') {
      const preSnap = room.sim.getSnapshot();
      for (const car of preSnap.cars) {
        if (!car.isBot) continue;
        const ai = room.botControllers.get(car.id);
        if (ai) {
          const res = ai.stepBot(
            car,
            preSnap.ball,
            preSnap.boostPads,
            preSnap.cars,
            room.botDifficulty,
            preSnap.tick,
            1 / 60
          );
          room.sim.setBotDebug(car.id, res.debug);
          if (res.teleportTarget) {
            room.sim.teleportCarToSafety(car.id, res.teleportTarget);
          }
          room.sim.setInput(car.id, res.input);
        }
      }
    }

    const events = room.sim.step(1 / 60);
    room.lastTickTime = now;
    room.phase = room.sim.phase;
    room.snapshotCounter++;

    if (events.length > 0) {
      broadcastMatchEvents(room, events);
      if (events.some((e) => e.type === 'match_end')) {
        broadcastRoomState(room);
      }
    }

    // Broadcast authoritative snapshot at 30Hz (every 2 physics ticks) or immediately on events
    if (room.snapshotCounter % 2 === 0 || events.length > 0) {
      const snapshot = room.sim.getSnapshot();
      const payload = JSON.stringify({ type: 'match:snapshot', snapshot });
      for (const p of room.players.values()) {
        if (p.ws && p.ws.readyState === WebSocket.OPEN) {
          p.ws.send(payload);
        }
      }
    }
  }
}, 1000 / 60);

async function bootstrap() {
  await ensureRapierReady();

  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = String(req.params.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      res.status(404).json({ exists: false, error: 'Party not found' });
      return;
    }
    res.json({ exists: true, room: getRoomState(room) });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(rawData.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'ping') {
        sendJson(ws, { type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        return;
      }

      if (type === 'room:create') {
        let code = generateRoomCode();
        while (rooms.has(code)) {
          code = generateRoomCode();
        }
        const playerId = crypto.randomUUID();
        const playerToken = crypto.randomBytes(16).toString('hex');
        const arenaId: ArenaId = VALID_ARENAS.has(String(msg.arenaId))
          ? (msg.arenaId as ArenaId)
          : 'neon_stadium';
        const matchDuration = clamp(msg.matchDuration ?? 180, 60, 600);
        const gameMode: PartyGameMode = VALID_MODES.has(msg.gameMode as PartyGameMode)
          ? (msg.gameMode as PartyGameMode)
          : 'team_2v1';
        const botDifficulty: BotDifficulty = msg.botDifficulty
          ? normalizeBotDifficulty(msg.botDifficulty)
          : 'all_star';

        const player: ServerPlayer = {
          id: playerId,
          token: playerToken,
          slotIndex: 0,
          name: sanitizeName(msg.playerName, 'Player 1'),
          avatarId: sanitizeAvatar(msg.avatarId, 'striker_helm'),
          team: 'blue',
          isHost: true,
          ready: true,
          connected: true,
          voiceActive: false,
          voiceMuted: false,
          customization: sanitizeCustomization(msg.customization),
          ws,
          lastSeen: Date.now(),
        };

        const room: RoomInstance = {
          code,
          arenaId,
          matchDuration,
          gameMode,
          botDifficulty,
          maxPlayers: MAX_PARTY_PLAYERS,
          phase: 'lobby',
          players: new Map([[playerId, player]]),
          botControllers: new Map(),
          sim: null,
          lastTickTime: Date.now(),
          snapshotCounter: 0,
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        socketSession.set(ws, { roomCode: code, playerId });

        sendJson(ws, {
          type: 'room:joined',
          playerId,
          playerToken,
          room: getRoomState(room),
        });
        return;
      }

      if (type === 'room:join') {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, {
            type: 'room:error',
            message: `Party "${code}" not found. Check the code and try again.`,
          });
          return;
        }
        if (room.players.size >= room.maxPlayers) {
          sendJson(ws, {
            type: 'room:error',
            message: `This party is full (maximum ${room.maxPlayers} players).`,
          });
          return;
        }

        const playerId = crypto.randomUUID();
        const playerToken = crypto.randomBytes(16).toString('hex');
        const slotIndex = getNextAvailableSlot(room);
        const team = assignTeamForJoiningPlayer(room);

        const player: ServerPlayer = {
          id: playerId,
          token: playerToken,
          slotIndex,
          name: sanitizeName(msg.playerName, `Player ${slotIndex + 1}`),
          avatarId: sanitizeAvatar(msg.avatarId, slotIndex === 1 ? 'turbo_flame' : 'volt_core'),
          team,
          isHost: false,
          ready: false,
          connected: true,
          voiceActive: false,
          voiceMuted: false,
          customization: sanitizeCustomization(msg.customization),
          ws,
          lastSeen: Date.now(),
        };
        room.players.set(playerId, player);
        socketSession.set(ws, { roomCode: code, playerId });

        // If match is already active, spawn joining party member cleanly into simulation
        if (room.sim && room.sim.phase !== 'finished') {
          const teamMembers = Array.from(room.players.values()).filter((p) => p.team === team);
          room.sim.addCar(
            {
              id: player.id,
              name: player.name,
              team,
              isBot: false,
              customization: player.customization,
              connected: true,
            },
            teamMembers.length - 1,
            teamMembers.length
          );
        }

        sendJson(ws, {
          type: 'room:joined',
          playerId,
          playerToken,
          room: getRoomState(room),
        });
        broadcastRoomState(room);
        if (room.sim) {
          sendJson(ws, { type: 'match:snapshot', snapshot: room.sim.getSnapshot() });
        }
        return;
      }

      if (type === 'room:reconnect') {
        const code = String(msg.code || '').toUpperCase().trim();
        const token = String(msg.playerToken || '');
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: 'Party expired or closed.' });
          return;
        }
        const player = Array.from(room.players.values()).find((p) => p.token === token);
        if (!player) {
          sendJson(ws, { type: 'room:error', message: 'Session token no longer valid or removed from party.' });
          return;
        }

        player.ws = ws;
        player.connected = true;
        player.lastSeen = Date.now();
        socketSession.set(ws, { roomCode: code, playerId: player.id });

        if (room.sim) {
          room.sim.setCarConnected(player.id, true);
        }

        sendJson(ws, {
          type: 'room:joined',
          playerId: player.id,
          playerToken: player.token,
          room: getRoomState(room),
        });
        broadcastRoomState(room);
        if (room.sim) {
          sendJson(ws, { type: 'match:snapshot', snapshot: room.sim.getSnapshot() });
        }
        return;
      }

      // All subsequent messages require authenticated room session
      const session = socketSession.get(ws);
      if (!session) return;
      const room = rooms.get(session.roomCode);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;

      player.lastSeen = Date.now();

      if (type === 'room:update_car') {
        player.customization = sanitizeCustomization(msg.customization);
        if (msg.playerName !== undefined) {
          player.name = sanitizeName(msg.playerName, player.name);
        }
        if (msg.avatarId !== undefined) {
          player.avatarId = sanitizeAvatar(msg.avatarId, player.avatarId);
        }
        if (room.sim) {
          room.sim.updateCarCustomization(player.id, player.customization);
        }
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:toggle_ready') {
        player.ready = typeof msg.ready === 'boolean' ? msg.ready : !player.ready;
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:switch_team') {
        if ((!room.sim || room.sim.phase === 'lobby') && room.gameMode === 'team_2v1') {
          player.team = player.team === 'blue' ? 'orange' : 'blue';
          broadcastRoomState(room);
        }
        return;
      }

      if (type === 'room:assign_team') {
        if (!player.isHost) return;
        if (room.sim && room.sim.phase !== 'lobby') return;
        if (room.gameMode !== 'team_2v1') return;

        const targetId = String(msg.targetPlayerId || '');
        const requestedTeam = msg.team === 'orange' ? 'orange' : 'blue';
        const target = room.players.get(targetId);
        if (!target) return;

        target.team = requestedTeam;
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:update_settings') {
        if (!player.isHost) return;
        if (VALID_ARENAS.has(String(msg.arenaId))) {
          room.arenaId = msg.arenaId as ArenaId;
        }
        if (msg.matchDuration !== undefined) {
          room.matchDuration = clamp(msg.matchDuration, 60, 600);
        }
        if (VALID_MODES.has(msg.gameMode as PartyGameMode)) {
          room.gameMode = msg.gameMode as PartyGameMode;
          if (!room.sim || room.sim.phase === 'lobby') {
            reconcileTeamsForMode(room);
          }
        }
        if (msg.botDifficulty !== undefined) {
          room.botDifficulty = VALID_DIFFICULTIES.has(msg.botDifficulty as BotDifficulty)
            ? (msg.botDifficulty as BotDifficulty)
            : normalizeBotDifficulty(msg.botDifficulty);
        }
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:kick_player') {
        if (!player.isHost) return;
        const targetId = String(msg.targetPlayerId || '');
        if (!targetId || targetId === player.id) return;
        const target = room.players.get(targetId);
        if (!target) return;

        const targetWs = target.ws;
        room.players.delete(targetId);
        if (room.sim) {
          room.sim.removeCar(targetId);
        }
        if (targetWs) {
          socketSession.delete(targetWs);
          sendJson(targetWs, {
            type: 'room:kicked',
            reason: 'You were removed from the party by the party leader.',
          });
        }
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:close_party') {
        if (!player.isHost) return;
        room.sim?.dispose();
        room.sim = null;
        room.botControllers.clear();
        for (const member of room.players.values()) {
          if (member.ws) {
            socketSession.delete(member.ws);
            sendJson(member.ws, {
              type: 'room:closed',
              reason:
                member.id === player.id
                  ? 'You closed the party.'
                  : 'The party leader closed the party.',
            });
          }
        }
        room.players.clear();
        rooms.delete(room.code);
        return;
      }

      if (type === 'room:start_match') {
        if (!player.isHost) return;
        startRoomSimulation(room);
        return;
      }

      if (type === 'room:rematch') {
        const hostConnected = Array.from(room.players.values()).some((p) => p.isHost && p.connected);
        if (hostConnected && !player.isHost) return;
        startRoomSimulation(room);
        return;
      }

      if (type === 'room:back_to_lobby') {
        if (!player.isHost) return;
        room.sim?.dispose();
        room.sim = null;
        room.botControllers.clear();
        room.phase = 'lobby';
        broadcastRoomState(room);
        return;
      }

      if (type === 'room:leave') {
        room.players.delete(player.id);
        socketSession.delete(ws);
        if (room.sim) {
          room.sim.removeCar(player.id);
        }
        if (room.players.size === 0) {
          room.sim?.dispose();
          room.botControllers.clear();
          rooms.delete(room.code);
        } else {
          if (player.isHost) {
            const remaining = Array.from(room.players.values()).sort((a, b) => a.slotIndex - b.slotIndex);
            const nextHost = remaining.find((p) => p.connected) ?? remaining[0];
            if (nextHost) {
              nextHost.isHost = true;
              nextHost.ready = true;
            }
          }
          broadcastRoomState(room);
        }
        return;
      }

      if (type === 'voice:status') {
        if (typeof msg.voiceActive === 'boolean') {
          player.voiceActive = msg.voiceActive;
        }
        if (typeof msg.voiceMuted === 'boolean') {
          player.voiceMuted = msg.voiceMuted;
        }
        broadcastRoomState(room);
        return;
      }

      if (type === 'voice:signal') {
        const toPlayerId = String(msg.toPlayerId || '');
        if (!toPlayerId || toPlayerId === player.id) return;
        const target = room.players.get(toPlayerId);
        // Only relay WebRTC signals between verified members of the SAME room
        if (!target || !target.ws) return;
        if (!msg.signal || typeof msg.signal !== 'object') return;
        sendJson(target.ws, {
          type: 'voice:signal',
          fromPlayerId: player.id,
          signal: msg.signal,
        });
        return;
      }

      if (type === 'player:input' && room.sim) {
        const raw = (msg.input && typeof msg.input === 'object' ? msg.input : {}) as Record<string, unknown>;
        const cleanInput: PlayerInput = {
          seq: typeof raw.seq === 'number' ? raw.seq : 0,
          throttle: clamp(raw.throttle, -1, 1),
          steer: clamp(raw.steer, -1, 1),
          jump: Boolean(raw.jump),
          boost: Boolean(raw.boost),
          powerslide: Boolean(raw.powerslide),
          reset: Boolean(raw.reset),
        };
        room.sim.setInput(player.id, cleanInput);
      }
    });

    ws.on('close', () => {
      const session = socketSession.get(ws);
      if (!session) return;
      const room = rooms.get(session.roomCode);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      if (player.ws !== ws) return;

      player.connected = false;
      player.voiceActive = false;
      player.ws = null;
      if (room.sim) {
        room.sim.setCarConnected(player.id, false);
      }
      broadcastRoomState(room);
    });
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Rocket Arena server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start Rocket Arena server:', err);
  process.exit(1);
});
