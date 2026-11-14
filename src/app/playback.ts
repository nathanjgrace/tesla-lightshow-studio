// A single clock shared by the audio, the 3D car and the composer. Views
// subscribe and get called every animation frame while playing (and on seek),
// without re-rendering React.

export type TimeListener = (timeMs: number) => void;

export class Playback {
  private audio: HTMLAudioElement | undefined;
  private audioUrl: string | undefined;
  private listeners = new Set<TimeListener>();
  private stateListeners = new Set<() => void>();
  private raf = 0;
  /** Clock used when there is no audio: performance.now() at time 0. */
  private clockStart = 0;
  private pausedAt = 0;
  private playing = false;
  private rate = 1;
  private muted = false;
  /** While set, playback wraps from the end of this range back to its start. */
  private loop: { startMs: number; endMs: number } | undefined;
  durationMs = 0;

  /** Playback speed: 1, or slower for checking fine timing. */
  setRate(rate: number): void {
    const t = this.timeMs();
    this.rate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
      this.audio.preservesPitch = true;
    } else if (this.playing) this.clockStart = performance.now() - t / rate;
    this.emitState();
  }

  get playbackRate(): number {
    return this.rate;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio) this.audio.muted = muted;
    this.emitState();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setLoop(range: { startMs: number; endMs: number } | undefined): void {
    this.loop = range;
  }

  setSource(audio: Blob | undefined, durationMs: number): void {
    this.pause();
    this.audio?.removeAttribute('src');
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audio = undefined;
    this.audioUrl = undefined;
    this.durationMs = durationMs;
    this.pausedAt = 0;
    if (audio) {
      this.audioUrl = URL.createObjectURL(audio);
      this.audio = new Audio(this.audioUrl);
      this.audio.preload = 'auto';
      this.audio.playbackRate = this.rate;
      this.audio.muted = this.muted;
      this.audio.addEventListener('ended', () => {
        if (this.loop && this.playing) {
          this.seek(this.loop.startMs);
          void this.audio?.play().catch(() => this.pause());
        } else this.pause();
      });
    }
    this.emit();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  timeMs(): number {
    if (!this.playing) return this.pausedAt;
    const t = this.audio ? this.audio.currentTime * 1000 : (performance.now() - this.clockStart) * this.rate;
    return Math.min(t, this.durationMs);
  }

  play(): void {
    if (this.playing) return;
    if (this.pausedAt >= this.durationMs) this.pausedAt = 0;
    if (this.loop && (this.pausedAt >= this.loop.endMs || this.pausedAt < this.loop.startMs)) this.pausedAt = this.loop.startMs;
    this.playing = true;
    if (this.audio) {
      this.audio.currentTime = this.pausedAt / 1000;
      void this.audio.play().catch(() => this.pause());
    } else {
      this.clockStart = performance.now() - this.pausedAt / this.rate;
    }
    const tick = () => {
      let t = this.timeMs();
      if (this.loop && t >= Math.min(this.loop.endMs, this.durationMs) - 1) {
        this.seek(this.loop.startMs);
        t = this.loop.startMs;
      }
      for (const l of this.listeners) l(t);
      if (!this.audio && t >= this.durationMs) {
        this.pause();
        return;
      }
      if (this.playing) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emitState();
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedAt = this.timeMs();
    this.playing = false;
    this.audio?.pause();
    cancelAnimationFrame(this.raf);
    this.emitState();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(timeMs: number): void {
    const t = Math.max(0, Math.min(timeMs, this.durationMs));
    if (this.playing) {
      if (this.audio) this.audio.currentTime = t / 1000;
      else this.clockStart = performance.now() - t / this.rate;
    } else {
      this.pausedAt = t;
    }
    this.emit(t);
  }

  /** Called with the current time every frame while playing, and on seek. */
  subscribe(listener: TimeListener): () => void {
    this.listeners.add(listener);
    listener(this.timeMs());
    return () => this.listeners.delete(listener);
  }

  /** Called when play/pause state changes. */
  subscribeState(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private emit(t = this.timeMs()): void {
    for (const l of this.listeners) l(t);
  }

  private emitState(): void {
    for (const l of this.stateListeners) l();
  }
}
