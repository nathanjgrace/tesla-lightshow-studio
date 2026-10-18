import { useEffect, useRef, useState } from 'react';
import type { Simulation } from '../core/simulate';
import { CAMERA_PRESETS, ModelXScene, type Finish } from './car/ModelXScene';
import type { Playback } from './playback';

function storedFinish(): Finish {
  try {
    return localStorage.getItem('finish') === 'glossy' ? 'glossy' : 'matte';
  } catch {
    return 'matte';
  }
}

export function CarView({ sim, playback }: { sim: Simulation | undefined; playback: Playback }) {
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<ModelXScene>();
  const [error, setError] = useState<string>();
  const [finish, setFinish] = useState<Finish>(storedFinish);

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
    let s: ModelXScene;
    try {
      s = new ModelXScene(el);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    setScene(s);
    // Lets automated browser checks inspect the scene during development.
    if (import.meta.env.DEV) (window as unknown as { __scene: ModelXScene }).__scene = s;
    return () => s.dispose();
  }, []);

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
        {CAMERA_PRESETS.map((p) => (
          <button key={p.name} onClick={() => scene?.flyTo(p)}>
            {p.name}
          </button>
        ))}
      </div>
      <p className="car-hint">Drag to rotate · scroll or pinch to zoom · right-drag to pan</p>
    </div>
  );
}
