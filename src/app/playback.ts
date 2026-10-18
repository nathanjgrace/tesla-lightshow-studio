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
  durationMs = 0;

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
      this.audio.addEventListener('ended', () => this.pause());
    }
    this.emit();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  timeMs(): number {
    if (!this.playing) return this.pausedAt;
    const t = this.audio ? this.audio.currentTime * 1000 : performance.now() - this.clockStart;
    return Math.min(t, this.durationMs);
  }

  play(): void {
    if (this.playing) return;
    if (this.pausedAt >= this.durationMs) this.pausedAt = 0;
    this.playing = true;
    if (this.audio) {
      this.audio.currentTime = this.pausedAt / 1000;
      void this.audio.play().catch(() => this.pause());
    } else {
      this.clockStart = performance.now() - this.pausedAt;
    }
    const tick = () => {
      const t = this.timeMs();
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
      else this.clockStart = performance.now() - t;
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
