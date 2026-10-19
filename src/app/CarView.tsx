import { Rotate3d } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { parsePaintChoice, resolvePaint, type PaintChoice } from '../core/paint';
import type { Simulation } from '../core/simulate';
import type { VehicleProfile } from '../core/vehicles';
import { CAMERA_PRESETS, CarScene } from './car/CarScene';
import { hasTeslaMesh, loadTeslaAsset, type TeslaAsset } from './car/teslaAssets';
import { PaintPicker } from './PaintPicker';
import type { Playback } from './playback';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered in private browsing; that's fine.
  }
}

const storedFlag = (key: string, fallback: boolean) => {
  const v = stored(key);
  return v === null ? fallback : v === '1';
};

// Paint is remembered per vehicle version, since each has its own colors.
const paintKey = (vehicle: VehicleProfile) => `paint:${vehicle.id}`;

type ModelState = { model: string; progress: number; asset?: TeslaAsset; failed?: boolean };

export function CarView({ sim, vehicle, playback }: { sim: Simulation | undefined; vehicle: VehicleProfile; playback: Playback }) {
  const body = vehicle.body;
  const host = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<CarScene>();
  const [error, setError] = useState<string>();
  // Older versions stored the reflections toggle as finish=glossy.
  const [reflections, setReflections] = useState(() => storedFlag('reflections', stored('finish') === 'glossy'));
  const [spin, setSpin] = useState(() => storedFlag('autoRotate', true));
  const [paints, setPaints] = useState<Record<string, PaintChoice | undefined>>({});
  const paint = vehicle.id in paints ? paints[vehicle.id] : parsePaintChoice(stored(paintKey(vehicle)));

  useEffect(() => {
    scene?.setAutoRotate(spin);
    store('autoRotate', spin ? '1' : '0');
  }, [scene, spin]);

  useEffect(() => {
    if (!scene) return;
    const update = () => scene.setPlaying(playback.isPlaying);
    update();
    return playback.subscribeState(update);
  }, [scene, playback]);

  useEffect(() => {
    scene?.setReflections(reflections);
    store('reflections', reflections ? '1' : '0');
  }, [scene, reflections]);

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

  // Tesla's own 3D model where it publishes one (Model S, Cybertruck); the
  // code-built body shows while it downloads, and if it can't be loaded.
  const [hq, setHq] = useState<ModelState>();
  useEffect(() => {
    if (!hasTeslaMesh(body.model)) return;
    let live = true;
    const model = body.model;
    setHq({ model, progress: 0 });
    loadTeslaAsset(model, (progress) => live && setHq({ model, progress }))
      .then((asset) => live && setHq({ model, progress: 1, asset }))
      .catch((e: unknown) => {
        console.warn("Couldn't load Tesla's 3D model", e);
        if (live) setHq({ model, progress: 1, failed: true });
      });
    return () => {
      live = false;
    };
  }, [body.model]);
  const asset = hq?.model === body.model ? hq.asset : undefined;
  const loading = hq?.model === body.model && !hq.asset && !hq.failed;

  useEffect(() => scene?.setBody(body, asset), [scene, body, asset]);

  const { hex, finish } = resolvePaint(paint, vehicle.id);
  useEffect(() => scene?.setPaint(hex, finish), [scene, hex, finish]);

  const choosePaint = (choice: PaintChoice) => {
    setPaints((p) => ({ ...p, [vehicle.id]: choice }));
    store(paintKey(vehicle), JSON.stringify(choice));
  };

  useEffect(() => {
    if (!scene) return;
    scene.setSimulation(sim);
    return playback.subscribe((t) => scene.setTime(t));
  }, [scene, sim, playback]);

  return (
    <div className="car-view">
      <div ref={host} className="car-canvas" />
      {error && <p className="pane-message">3D preview isn't available in this browser: {error}</p>}
      <div className="pane-badge">
        <span className="pane-badge-title">{vehicle.name}</span>
        <span>
          {asset
            ? "Tesla's 3D model"
            : loading
              ? `Loading Tesla's 3D model… ${Math.round((hq?.progress ?? 0) * 100)}%`
              : 'Stylized preview'}
        </span>
      </div>
      <PaintPicker vehicle={vehicle} choice={paint} onChange={choosePaint} reflections={reflections} onReflections={setReflections} />
      <div className="camera-presets" role="group" aria-label="Camera views">
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
