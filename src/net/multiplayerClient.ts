import type {
  ArenaId,
  AvatarId,
  BotDifficulty,
  CarCustomization,
  MatchEvent,
  MatchStateSnapshot,
  PartyGameMode,
  PlayerInput,
  Quat,
  RoomState,
  Team,
  Vec3,
} from '../shared/types.ts';
import type { VoiceSignalPayload } from './voiceChat.ts';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface BufferedSnapshot {
  recvTime: number;
  snapshot: MatchStateSnapshot;
}

interface PendingInputEntry {
  seq: number;
  timeMs: number;
  input: PlayerInput;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    const rx = lerp(a.x, bx, t);
    const ry = lerp(a.y, by, t);
    const rz = lerp(a.z, bz, t);
    const rw = lerp(a.w, bw, t);
    const inv = 1 / Math.hypot(rx, ry, rz, rw);
    return { x: rx * inv, y: ry * inv, z: rz * inv, w: rw * inv };
  }
  const theta0 = Math.acos(Math.max(-1, Math.min(1, dot)));
  const theta = theta0 * t;
  const sinTheta = Math.sin(theta);
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * sinTheta) / sinTheta0;
  const s1 = sinTheta / sinTheta0;
  return {
    x: s0 * a.x + s1 * bx,
    y: s0 * a.y + s1 * by,
    z: s0 * a.z + s1 * bz,
    w: s0 * a.w + s1 * bw,
  };
}

function rotateForward(q: Quat): Vec3 {
  const ix = -q.y;
  const iy = q.x;
  const iz = -q.w;
  const iw = q.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private pingTimer: number | null = null;
  private buffer: BufferedSnapshot[] = [];
  private pendingEvents: MatchEvent[] = [];
  private unackedInputs: PendingInputEntry[] = [];
  private lastPingMs = 30;

  public playerId: string | null = null;
  public playerToken: string | null = null;
  public roomCode: string | null = null;

  public onStatusChange?: (status: ConnectionStatus) => void;
  public onJoined?: (data: { playerId: string; playerToken: string; room: RoomState }) => void;
  public onRoomState?: (room: RoomState) => void;
  public onError?: (message: string) => void;
  public onPing?: (rttMs: number) => void;
  public onKicked?: (reason: string) => void;
  public onPartyClosed?: (reason: string) => void;
  public onVoiceSignal?: (fromPlayerId: string, signal: VoiceSignalPayload) => void;

  private getWsUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }

  public connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }

    this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.getWsUrl());
      this.ws = ws;

      const onOpen = () => {
        this.setStatus('connected');
        this.startPingLoop();
        resolve();
      };

      const onError = () => {
        this.setStatus('disconnected');
        reject(new Error('Could not connect to multiplayer server.'));
      };

      ws.addEventListener('open', onOpen, { once: true });
      ws.addEventListener('error', onError, { once: true });

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
          this.handleMessage(msg);
        } catch {
          // ignore malformed packet
        }
      };

      ws.onclose = () => {
        this.stopPingLoop();
        this.setStatus('disconnected');
      };
    });
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.onStatusChange?.(s);
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', clientTime: performance.now() });
    }, 2000);
    this.send({ type: 'ping', clientTime: performance.now() });
  }

  private stopPingLoop(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = String(msg.type || '');
    if (type === 'pong') {
      const sent = Number(msg.clientTime || 0);
      if (sent > 0) {
        const rtt = Math.max(1, Math.round(performance.now() - sent));
        this.lastPingMs = rtt;
        this.onPing?.(rtt);
      }
      return;
    }

    if (type === 'room:joined') {
      this.playerId = String(msg.playerId);
      this.playerToken = String(msg.playerToken);
      const room = msg.room as RoomState;
      this.roomCode = room.code;
      this.buffer = [];
      this.pendingEvents = [];
      this.unackedInputs = [];
      this.onJoined?.({ playerId: this.playerId, playerToken: this.playerToken, room });
      return;
    }

    if (type === 'room:state') {
      this.onRoomState?.(msg.room as RoomState);
      return;
    }

    if (type === 'room:kicked') {
      this.clearSessionState();
      this.onKicked?.(String(msg.reason || 'Removed from party.'));
      return;
    }

    if (type === 'room:closed') {
      this.clearSessionState();
      this.onPartyClosed?.(String(msg.reason || 'Party closed by leader.'));
      return;
    }

    if (type === 'room:error') {
      this.onError?.(String(msg.message || 'Multiplayer error'));
      return;
    }

    if (type === 'voice:signal') {
      const fromPlayerId = String(msg.fromPlayerId || '');
      if (fromPlayerId && msg.signal && typeof msg.signal === 'object') {
        this.onVoiceSignal?.(fromPlayerId, msg.signal as VoiceSignalPayload);
      }
      return;
    }

    if (type === 'match:events') {
      const evs = msg.events as MatchEvent[];
      if (Array.isArray(evs)) {
        this.pendingEvents.push(...evs);
      }
      return;
    }

    if (type === 'match:snapshot') {
      const snapshot = msg.snapshot as MatchStateSnapshot;
      const now = performance.now();
      this.buffer.push({ recvTime: now, snapshot });
      if (this.buffer.length > 24) {
        this.buffer.shift();
      }
      // Prune acknowledged local inputs for reconciliation
      if (this.playerId) {
        const localCar = snapshot.cars.find((c) => c.id === this.playerId);
        if (localCar && typeof localCar.ackSeq === 'number') {
          this.unackedInputs = this.unackedInputs.filter((entry) => entry.seq > localCar.ackSeq!);
        }
      }
    }
  }

  private clearSessionState(): void {
    this.roomCode = null;
    this.playerId = null;
    this.playerToken = null;
    this.buffer = [];
    this.pendingEvents = [];
    this.unackedInputs = [];
  }

  public send(payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  public async createRoom(opts: {
    playerName: string;
    avatarId?: AvatarId;
    arenaId: ArenaId;
    matchDuration: number;
    gameMode?: PartyGameMode;
    botDifficulty?: BotDifficulty;
    customization: CarCustomization;
  }): Promise<void> {
    await this.connect();
    this.send({ type: 'room:create', ...opts });
  }

  public async joinRoom(opts: {
    code: string;
    playerName: string;
    avatarId?: AvatarId;
    customization: CarCustomization;
  }): Promise<void> {
    await this.connect();
    this.send({ type: 'room:join', ...opts });
  }

  public async reconnectRoom(code?: string, token?: string): Promise<void> {
    const targetCode = code || this.roomCode;
    const targetToken = token || this.playerToken;
    if (!targetCode || !targetToken) {
      throw new Error('No active session to reconnect.');
    }
    await this.connect();
    this.send({ type: 'room:reconnect', code: targetCode, playerToken: targetToken });
  }

  public updateCar(customization: CarCustomization, playerName?: string, avatarId?: AvatarId): void {
    this.send({ type: 'room:update_car', customization, playerName, avatarId });
  }

  public toggleReady(ready?: boolean): void {
    this.send({ type: 'room:toggle_ready', ready });
  }

  public switchTeam(): void {
    this.send({ type: 'room:switch_team' });
  }

  public assignTeam(targetPlayerId: string, team: Team): void {
    this.send({ type: 'room:assign_team', targetPlayerId, team });
  }

  public updateRoomSettings(opts: {
    arenaId?: ArenaId;
    matchDuration?: number;
    gameMode?: PartyGameMode;
    botDifficulty?: BotDifficulty;
  }): void {
    this.send({ type: 'room:update_settings', ...opts });
  }

  public kickPlayer(targetPlayerId: string): void {
    this.send({ type: 'room:kick_player', targetPlayerId });
  }

  public closeParty(): void {
    this.buffer = [];
    this.pendingEvents = [];
    this.unackedInputs = [];
    this.send({ type: 'room:close_party' });
  }

  public startMatch(): void {
    this.buffer = [];
    this.pendingEvents = [];
    this.unackedInputs = [];
    this.send({ type: 'room:start_match' });
  }

  public requestRematch(): void {
    this.buffer = [];
    this.pendingEvents = [];
    this.unackedInputs = [];
    this.send({ type: 'room:rematch' });
  }

  public backToLobby(): void {
    this.buffer = [];
    this.pendingEvents = [];
    this.unackedInputs = [];
    this.send({ type: 'room:back_to_lobby' });
  }

  public leaveRoom(): void {
    this.send({ type: 'room:leave' });
    this.clearSessionState();
  }

  public sendVoiceStatus(voiceActive: boolean, voiceMuted: boolean): void {
    this.send({ type: 'voice:status', voiceActive, voiceMuted });
  }

  public sendVoiceSignal(toPlayerId: string, signal: VoiceSignalPayload): void {
    this.send({ type: 'voice:signal', toPlayerId, signal });
  }

  public sendInput(input: PlayerInput): void {
    const now = performance.now();
    this.unackedInputs.push({ seq: input.seq, timeMs: now, input });
    if (this.unackedInputs.length > 90) {
      this.unackedInputs.shift();
    }
    this.send({ type: 'player:input', input });
  }

  public getInterpolatedState(nowMs: number): {
    snapshot: MatchStateSnapshot | null;
    events: MatchEvent[];
  } {
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    if (this.buffer.length === 0) {
      return { snapshot: null, events };
    }
    if (this.buffer.length === 1) {
      return { snapshot: this.buffer[0].snapshot, events };
    }

    // 50ms interpolation delay absorbs jitter for remote cars & ball
    const renderTime = nowMs - 50;

    let idx = this.buffer.length - 2;
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].recvTime <= renderTime && this.buffer[i + 1].recvTime >= renderTime) {
        idx = i;
        break;
      }
    }

    const a = this.buffer[idx];
    const b = this.buffer[idx + 1];
    const latest = this.buffer[this.buffer.length - 1];

    // Extrapolation lead for local car prediction & reconciliation
    const localLeadSec = Math.min(0.06, Math.max(0.016, this.lastPingMs / 2000));
    const latestUnacked = this.unackedInputs[this.unackedInputs.length - 1]?.input;

    const predictLocalCar = (serverCar: MatchStateSnapshot['cars'][number]) => {
      if (serverCar.id !== this.playerId || latest.snapshot.phase !== 'playing') {
        return serverCar;
      }
      const fwd = rotateForward(serverCar.quat);
      const accelAssist = latestUnacked
        ? latestUnacked.throttle * 12 + (latestUnacked.boost && serverCar.boost > 0 ? 18 : 0)
        : 0;
      const vx = serverCar.vel.x + fwd.x * accelAssist * localLeadSec;
      const vz = serverCar.vel.z + fwd.z * accelAssist * localLeadSec;
      return {
        ...serverCar,
        pos: {
          x: serverCar.pos.x + vx * localLeadSec * 0.55,
          y: serverCar.pos.y + serverCar.vel.y * localLeadSec * 0.45,
          z: serverCar.pos.z + vz * localLeadSec * 0.55,
        },
        steerAngle: latestUnacked ? latestUnacked.steer * 0.55 : serverCar.steerAngle,
      };
    };

    if (renderTime > b.recvTime) {
      const extraSec = Math.min(0.07, (renderTime - b.recvTime) / 1000);
      const snap = b.snapshot;
      return {
        events,
        snapshot: {
          ...snap,
          ball: {
            ...snap.ball,
            pos: {
              x: snap.ball.pos.x + snap.ball.vel.x * extraSec,
              y: snap.ball.pos.y + snap.ball.vel.y * extraSec,
              z: snap.ball.pos.z + snap.ball.vel.z * extraSec,
            },
          },
          cars: snap.cars.map((c) => {
            if (c.id === this.playerId) {
              const latestCar = latest.snapshot.cars.find((lc) => lc.id === c.id) ?? c;
              return predictLocalCar(latestCar);
            }
            return {
              ...c,
              pos: {
                x: c.pos.x + c.vel.x * extraSec,
                y: c.pos.y + c.vel.y * extraSec,
                z: c.pos.z + c.vel.z * extraSec,
              },
            };
          }),
        },
      };
    }

    const span = Math.max(1, b.recvTime - a.recvTime);
    const t = Math.max(0, Math.min(1, (renderTime - a.recvTime) / span));

    const mapA = new Map(a.snapshot.cars.map((c) => [c.id, c]));
    const interpCars = b.snapshot.cars.map((cb) => {
      if (cb.id === this.playerId) {
        const latestCar = latest.snapshot.cars.find((lc) => lc.id === cb.id) ?? cb;
        return predictLocalCar(latestCar);
      }
      const ca = mapA.get(cb.id);
      if (!ca) return cb;
      return {
        ...cb,
        pos: lerpVec3(ca.pos, cb.pos, t),
        quat: slerpQuat(ca.quat, cb.quat, t),
        vel: lerpVec3(ca.vel, cb.vel, t),
        boost: lerp(ca.boost, cb.boost, t),
        steerAngle: lerp(ca.steerAngle, cb.steerAngle, t),
        wheelSpin: lerp(ca.wheelSpin, cb.wheelSpin, t),
        driftIntensity: lerp(ca.driftIntensity ?? 0, cb.driftIntensity ?? 0, t),
        brakeHeat: lerp(ca.brakeHeat ?? 0, cb.brakeHeat ?? 0, t),
        wheelTravel:
          ca.wheelTravel && cb.wheelTravel
            ? ([
                lerp(ca.wheelTravel[0], cb.wheelTravel[0], t),
                lerp(ca.wheelTravel[1], cb.wheelTravel[1], t),
                lerp(ca.wheelTravel[2], cb.wheelTravel[2], t),
                lerp(ca.wheelTravel[3], cb.wheelTravel[3], t),
              ] as [number, number, number, number])
            : cb.wheelTravel,
      };
    });

    return {
      events,
      snapshot: {
        ...b.snapshot,
        cars: interpCars,
        ball: {
          ...b.snapshot.ball,
          pos: lerpVec3(a.snapshot.ball.pos, b.snapshot.ball.pos, t),
          quat: slerpQuat(a.snapshot.ball.quat, b.snapshot.ball.quat, t),
          vel: lerpVec3(a.snapshot.ball.vel, b.snapshot.ball.vel, t),
        },
      },
    };
  }

  public disconnect(): void {
    this.stopPingLoop();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }
}
