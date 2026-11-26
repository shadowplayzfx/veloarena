import type { RoomPlayerInfo } from '../shared/types.ts';

export type VoiceStatus = 'off' | 'requesting' | 'active' | 'denied' | 'unsupported';

export interface VoiceSignalPayload {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface VoiceState {
  status: VoiceStatus;
  micEnabled: boolean;
  selfMuted: boolean;
  pushToTalk: boolean;
  pttHeld: boolean;
  isSpeaking: boolean;
  error: string | null;
  mutedPeers: string[];
  peerConnectionStates: Record<string, string>;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
}

export class VoiceChatManager {
  private localStream: MediaStream | null = null;
  private localPlayerId: string | null = null;
  private peers: Map<string, PeerEntry> = new Map();
  private mutedPeers: Set<string> = new Set();

  private status: VoiceStatus = 'off';
  private micEnabled = false;
  private selfMuted = false;
  private pushToTalk = false;
  private pttHeld = false;
  private isSpeaking = false;
  private error: string | null = null;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterTimer: number | null = null;
  private meterData: Uint8Array<ArrayBuffer> | null = null;
  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null;

  public onSendSignal?: (toPlayerId: string, signal: VoiceSignalPayload) => void;
  public onStatusBroadcast?: (voiceActive: boolean, voiceMuted: boolean) => void;
  public onStateChange?: (state: VoiceState) => void;

  constructor() {
    if (typeof window !== 'undefined') {
      this.keyDownHandler = (e: KeyboardEvent) => {
        if (e.code === 'KeyT' && !e.repeat && this.pushToTalk && this.micEnabled) {
          const tag = (e.target as HTMLElement | null)?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA') return;
          this.setPttHeld(true);
        }
      };
      this.keyUpHandler = (e: KeyboardEvent) => {
        if (e.code === 'KeyT' && this.pushToTalk) {
          this.setPttHeld(false);
        }
      };
      window.addEventListener('keydown', this.keyDownHandler);
      window.addEventListener('keyup', this.keyUpHandler);
    }
  }

  public getState(): VoiceState {
    const peerConnectionStates: Record<string, string> = {};
    for (const [id, entry] of this.peers.entries()) {
      peerConnectionStates[id] = entry.pc.connectionState;
    }
    return {
      status: this.status,
      micEnabled: this.micEnabled,
      selfMuted: this.selfMuted,
      pushToTalk: this.pushToTalk,
      pttHeld: this.pttHeld,
      isSpeaking: this.isSpeaking,
      error: this.error,
      mutedPeers: Array.from(this.mutedPeers),
      peerConnectionStates,
    };
  }

  private emitState(): void {
    this.onStateChange?.(this.getState());
  }

  private applyMicTrackState(): void {
    const shouldTransmit =
      this.micEnabled && !this.selfMuted && (!this.pushToTalk || this.pttHeld);
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = shouldTransmit;
      }
    }
    this.onStatusBroadcast?.(this.micEnabled, !shouldTransmit);
  }

  public async toggleMicrophone(partyPlayers: RoomPlayerInfo[], localPlayerId: string): Promise<void> {
    if (this.micEnabled) {
      this.disableVoice();
      return;
    }
    await this.enableVoice(partyPlayers, localPlayerId);
  }

  public async enableVoice(partyPlayers: RoomPlayerInfo[], localPlayerId: string): Promise<void> {
    this.localPlayerId = localPlayerId;
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof RTCPeerConnection === 'undefined'
    ) {
      this.status = 'unsupported';
      this.error = 'Microphone or WebRTC is not supported in this browser.';
      this.emitState();
      return;
    }

    this.status = 'requesting';
    this.error = null;
    this.emitState();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.localStream = stream;
      this.micEnabled = true;
      this.selfMuted = false;
      this.status = 'active';
      this.startSpeakingMeter(stream);
      this.applyMicTrackState();
      this.syncPartyPeers(partyPlayers, localPlayerId);
      this.emitState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = 'denied';
      this.micEnabled = false;
      this.error = msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('permission')
        ? 'Microphone permission denied. Allow mic access in your browser to use party voice.'
        : `Could not access microphone: ${msg}`;
      this.emitState();
    }
  }

  public toggleSelfMute(): void {
    if (!this.micEnabled) return;
    this.selfMuted = !this.selfMuted;
    this.applyMicTrackState();
    this.emitState();
  }

  public setPushToTalk(enabled: boolean): void {
    this.pushToTalk = enabled;
    if (!enabled) this.pttHeld = false;
    this.applyMicTrackState();
    this.emitState();
  }

  public setPttHeld(held: boolean): void {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    this.applyMicTrackState();
    this.emitState();
  }

  public togglePeerMute(playerId: string): void {
    if (this.mutedPeers.has(playerId)) {
      this.mutedPeers.delete(playerId);
    } else {
      this.mutedPeers.add(playerId);
    }
    const entry = this.peers.get(playerId);
    if (entry) {
      entry.audioEl.muted = this.mutedPeers.has(playerId);
    }
    this.emitState();
  }

  public syncPartyPeers(players: RoomPlayerInfo[], localPlayerId: string | null): void {
    this.localPlayerId = localPlayerId;
    if (!this.micEnabled || !localPlayerId) {
      return;
    }

    const activeRemoteIds = new Set(
      players.filter((p) => p.id !== localPlayerId && p.connected).map((p) => p.id)
    );

    // Close removed/disconnected peers
    for (const [peerId] of this.peers.entries()) {
      if (!activeRemoteIds.has(peerId)) {
        this.closePeer(peerId);
      }
    }

    // Create connections for connected peers (deterministic offerer: smaller ID initiates offer)
    for (const peerId of activeRemoteIds) {
      if (!this.peers.has(peerId)) {
        const isOfferer = localPlayerId < peerId;
        void this.createPeerConnection(peerId, isOfferer);
      }
    }
  }

  private async createPeerConnection(peerId: string, initiateOffer: boolean): Promise<PeerEntry> {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.muted = this.mutedPeers.has(peerId);

    const entry: PeerEntry = { pc, audioEl, pendingCandidates: [] };
    this.peers.set(peerId, entry);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.onSendSignal?.(peerId, { candidate: ev.candidate.toJSON() });
      }
    };

    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        audioEl.srcObject = ev.streams[0];
        void audioEl.play().catch(() => {
          // Autoplay will resume on next user interaction
        });
      }
    };

    pc.onconnectionstatechange = () => {
      this.emitState();
    };

    if (initiateOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (pc.localDescription) {
          this.onSendSignal?.(peerId, { sdp: pc.localDescription.toJSON() });
        }
      } catch {
        // Ignore transient negotiation race
      }
    }

    this.emitState();
    return entry;
  }

  public async handleSignal(fromPlayerId: string, signal: VoiceSignalPayload): Promise<void> {
    if (!this.localPlayerId || fromPlayerId === this.localPlayerId) return;

    // Only accept WebRTC calls if user enabled voice OR prepare passive listener if active
    if (!this.micEnabled) return;

    let entry = this.peers.get(fromPlayerId);
    if (!entry) {
      entry = await this.createPeerConnection(fromPlayerId, false);
    }

    const { pc } = entry;
    try {
      if (signal.sdp) {
        const desc = new RTCSessionDescription(signal.sdp);
        await pc.setRemoteDescription(desc);
        while (entry.pendingCandidates.length > 0) {
          const cand = entry.pendingCandidates.shift();
          if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
        if (desc.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (pc.localDescription) {
            this.onSendSignal?.(fromPlayerId, { sdp: pc.localDescription.toJSON() });
          }
        }
      } else if (signal.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          entry.pendingCandidates.push(signal.candidate);
        }
      }
    } catch {
      // Ignore stale ICE / SDP packets on peer reconnect
    }
  }

  private startSpeakingMeter(stream: MediaStream): void {
    this.stopSpeakingMeter();
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);
      this.meterData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.meterTimer = window.setInterval(() => {
        if (!this.analyser || !this.meterData) return;
        const shouldTransmit =
          this.micEnabled && !this.selfMuted && (!this.pushToTalk || this.pttHeld);
        if (!shouldTransmit) {
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.emitState();
          }
          return;
        }
        this.analyser.getByteFrequencyData(this.meterData);
        let sum = 0;
        for (let i = 0; i < this.meterData.length; i++) sum += this.meterData[i];
        const avg = sum / this.meterData.length;
        const speaking = avg > 14;
        if (speaking !== this.isSpeaking) {
          this.isSpeaking = speaking;
          this.emitState();
        }
      }, 120);
    } catch {
      // AudioContext meter optional
    }
  }

  private stopSpeakingMeter(): void {
    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.analyser = null;
    this.meterData = null;
    this.isSpeaking = false;
  }

  private closePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    entry.audioEl.srcObject = null;
    entry.audioEl.remove();
    this.peers.delete(peerId);
  }

  public disableVoice(): void {
    this.stopSpeakingMeter();
    for (const peerId of Array.from(this.peers.keys())) {
      this.closePeer(peerId);
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
    this.micEnabled = false;
    this.selfMuted = false;
    this.pttHeld = false;
    this.status = 'off';
    this.onStatusBroadcast?.(false, true);
    this.emitState();
  }

  public dispose(): void {
    this.disableVoice();
    if (typeof window !== 'undefined') {
      if (this.keyDownHandler) window.removeEventListener('keydown', this.keyDownHandler);
      if (this.keyUpHandler) window.removeEventListener('keyup', this.keyUpHandler);
    }
  }
}
