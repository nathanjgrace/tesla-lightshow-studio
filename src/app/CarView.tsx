import { Rotate3d } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../core/simulate';
import type { BodyStyle } from '../core/vehicles';
import { CAMERA_PRESETS, CarScene, type Finish } from './car/CarScene';
import type { Playback } from './playback';

function storedFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function storeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Not remembered in private browsing; that's fine.
  }
}

function storedFinish(): Finish {
  try {
    return localStorage.getItem('finish') === 'glossy' ? 'glossy' : 'matte';
  } catch {
    return 'matte';
  }
}

export function CarView({ sim, body, playback }: { sim: Simulation | undefined; body: BodyStyle; playback: Playback }) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<CarScene>();
  const [error, setError] = useState<string>();
  const [finish, setFinish] = useState<Finish>(storedFinish);
  const [spin, setSpin] = useState(() => storedFlag('autoRotate', true));

  useEffect(() => {
    scene?.setAutoRotate(spin);
    storeFlag('autoRotate', spin);
  }, [scene, spin]);

  useEffect(() => {
    if (!scene) return;
    const update = () => scene.setPlaying(playback.isPlaying);
    update();
    return playback.subscribeState(update);
  }, [scene, playback]);

  useEffect(() => {
    scene?.setFinish(finish);
    try {
      localStorage.setItem('finish', finish);
    } catch {
      // Not remembered in private browsing; that's fine.
    }
  }, [scene, finish]);

  useEffect(() => {
    const el = host.current!;
    let s: CarScene;
    try {
      s = new CarScene(el);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setScene(s);
    // Lets automated browser checks inspect the scene during development.
    if (import.meta.env.DEV) (window as unknown as { __scene: CarScene }).__scene = s;
    return () => s.dispose();
  }, []);

  useEffect(() => scene?.setBody(body), [scene, body]);

  useEffect(() => {
    if (!scene) return;
    scene.setSimulation(sim);
    return playback.subscribe((t) => scene.setTime(t));
  }, [scene, sim, playback]);

  return (
    <div className="car-view">
      <div ref={host} className="car-canvas" />
      {error && <p className="pane-message">3D preview isn't available in this browser: {error}</p>}
      <div className="camera-presets" role="group" aria-label="Camera views">
        <button
          className={finish === 'glossy' ? 'on' : ''}
          onClick={() => setFinish(finish === 'matte' ? 'glossy' : 'matte')}
          title="Glossy paint reflects the virtual studio lights; matte doesn't, so only real light show effects glow"
        >
          {finish === 'matte' ? 'Reflections: off' : 'Reflections: on'}
        </button>
        <span className="preset-gap" />
        <button
          className={`icon-toggle${spin ? ' on' : ''}`}
          onClick={() => setSpin(!spin)}
          aria-pressed={spin}
          title={spin ? 'Auto-rotate is on: the camera slowly circles the car while the show plays' : 'Auto-rotate is off'}
        >
          <Rotate3d size={14} />
          Auto-rotate
        </button>
        <span className="preset-gap" />
        {CAMERA_PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => {
              // Picking a view means "hold it here".
              setSpin(false);
              scene?.flyTo(p);
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="car-hint">Drag to rotate · scroll or pinch to zoom · right-drag to pan</p>
    </div>
  );
}
