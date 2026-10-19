// Close-up pictures of what each channel drives on the current car, rendered
// from the 3D preview a few at a time and cached until the car changes.

import type { CarScene } from './car/CarScene';

export interface ChannelPicture {
  image: HTMLCanvasElement;
  url: string;
}

const WIDTH = 300;
const HEIGHT = 190;

export class ChannelPreviews {
  private readonly cache = new Map<string, ChannelPicture | null>();
  private readonly pending = new Map<string, readonly string[]>();
  private readonly listeners = new Set<() => void>();
  private timer = 0;
  private readonly off: () => void;

  constructor(private readonly scene: CarScene) {
    this.off = scene.onBodyChange(() => {
      this.cache.clear();
      this.emit();
    });
  }

  /** The picture for some channels: undefined while it's being made, null if the model has nothing to show. */
  get(ids: readonly string[]): ChannelPicture | null | undefined {
    const key = ids.join(',');
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (!this.pending.has(key)) {
      this.pending.set(key, ids);
      this.schedule();
    }
    return undefined;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.off();
    this.listeners.clear();
  }

  private schedule() {
    if (this.timer) return;
    // One picture at a time, between frames, so the preview stays smooth.
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const next = this.pending.entries().next();
      if (next.done) return;
      const [key, ids] = next.value;
      this.pending.delete(key);
      let picture: ChannelPicture | null = null;
      try {
        const image = this.scene.channelPreview(ids, WIDTH, HEIGHT);
        if (image) picture = { image, url: image.toDataURL('image/png') };
      } catch (e) {
        console.warn("Couldn't render a channel preview", e);
      }
      this.cache.set(key, picture);
      this.emit();
      if (this.pending.size) this.schedule();
    }, 30);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }
}
