import { useEffect, useRef, useState, type ReactNode } from 'react';
import { decodeVin, VinError, type VinResult } from '../core/vin';
import type { VehicleProfile } from '../core/vehicles';

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function VinDialog({ onPick, onClose }: { onPick: (v: VehicleProfile) => void; onClose: () => void }) {
  const [vin, setVin] = useState('');
  const [result, setResult] = useState<VinResult>();
  const [error, setError] = useState<string>();

  function lookUp(e: React.FormEvent) {
    e.preventDefault();
    try {
      setResult(decodeVin(vin));
      setError(undefined);
    } catch (err) {
      setResult(undefined);
      setError(err instanceof VinError ? err.message : String(err));
    }
  }

  return (
    <Dialog title="Look up your car by VIN" onClose={onClose}>
      <p className="muted">
        Your VIN is the 17-character code shown in the car under <em>Controls → Software</em>, at the bottom of the driver's side
        of the windshield, and on your registration. It's decoded right here in your browser and never sent anywhere.
      </p>
      <form onSubmit={lookUp} className="vin-form">
        <input
          value={vin}
          onChange={(e) => setVin(e.target.value)}
          placeholder="e.g. 5YJXCBE25MF123456"
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
          aria-label="VIN"
        />
        <button type="submit" className="primary">
          Look up
        </button>
      </form>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="vin-result">
          <p>
            <strong>
              {result.modelYear} {result.modelName}
            </strong>
            {result.plant && <span className="muted"> · built in {result.plant}</span>}
          </p>
          {!result.checkDigitValid && (
            <p className="warn-text">This VIN's check digit doesn't add up, which usually means a typo. Double-check it.</p>
          )}
          {result.unsupported && <p className="error-text">{result.unsupported}.</p>}
          {result.candidates.length > 1 && <p>That model year had more than one version. Which matches your car?</p>}
          <div className="choices">
            {result.candidates.map((v) => (
              <button key={v.id} className="choice" onClick={() => onPick(v)}>
                <strong>{v.name}</strong>
                <span className="muted">{v.hint}</span>
              </button>
            ))}
          </div>
          <p className="muted small">
            Some features (like side markers, fog lights or power liftgates) depend on region and options, not just the model
            year. The composer marks those rows with *.
          </p>
        </div>
      )}
    </Dialog>
  );
}

export function UsbHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Putting a show on your Tesla" onClose={onClose} wide>
      <h3>Tesla's requirements</h3>
      <p className="muted small">
        From Tesla's official guide,{' '}
        <a href="https://github.com/teslamotors/light-show#running-a-custom-show-on-a-vehicle" target="_blank" rel="noreferrer">
          github.com/teslamotors/light-show
        </a>
        .
      </p>
      <ul>
        <li>
          The USB drive must be formatted as <strong>exFAT</strong>, <strong>FAT32</strong> (Windows), <strong>MS-DOS (FAT)</strong>{' '}
          (Mac), ext3 or ext4. <strong>NTFS doesn't work.</strong>
        </li>
        <li>
          It needs a folder at the top level named exactly <code>LightShow</code> (capital L and S, no space).
        </li>
        <li>
          That folder holds the show file (<code>.fseq</code>) and its music (<code>.wav</code> or <code>.mp3</code>, WAV recommended)
          with the <strong>same name</strong>, e.g. <code>myshow.fseq</code> and <code>myshow.wav</code>.
        </li>
        <li>You can keep several shows on one drive (car software 2023.44.25 or newer).</li>
        <li>
          The drive must <strong>not</strong> have a <code>TeslaCam</code> folder at the top level, or any map or firmware update
          files. Use a separate drive from your dashcam one.
        </li>
        <li>Music must be 44.1 kHz. Exports from this app already are.</li>
      </ul>

      <h3>Copying the export onto the drive</h3>
      <ol>
        <li>
          Click <strong>Export → Download for USB</strong>. You get a <code>.zip</code> file.
        </li>
        <li>Plug in the USB drive.</li>
        <li>
          Unzip the download (double-click it on a Mac; on Windows, right-click → <em>Extract All…</em>). Inside is a{' '}
          <code>LightShow</code> folder.
        </li>
        <li>
          Drag that <code>LightShow</code> folder onto the USB drive. If the drive already has one, put the two show files inside the
          existing folder instead.
        </li>
        <li>Eject the drive before unplugging it.</li>
      </ol>

      <h3>Formatting a drive (only if it isn't already exFAT or FAT32)</h3>
      <p className="warn-text">Formatting erases everything on the drive.</p>
      <p>
        <strong>Windows:</strong> open File Explorer → <em>This PC</em> → right-click the USB drive → <em>Format…</em> → File system:{' '}
        <em>exFAT</em> → <em>Start</em>.
      </p>
      <p>
        <strong>Mac:</strong> open <em>Disk Utility</em> (Applications → Utilities) → choose <em>View → Show All Devices</em> →
        select the USB drive itself (the top entry, not the volume under it) → <em>Erase</em> → Format: <em>ExFAT</em> (or{' '}
        <em>MS-DOS (FAT)</em>) → Scheme: <em>Master Boot Record</em> → <em>Erase</em>.
      </p>

      <h3>Playing it in the car</h3>
      <ol>
        <li>Plug the drive into a front USB port or the glovebox USB port and wait a few seconds.</li>
        <li>
          On the touchscreen open <strong>Toybox → Light Show</strong> and tap <strong>Schedule Show</strong>.
        </li>
        <li>Your show appears in the drop-down. Pick it and start it.</li>
      </ol>
      <p className="muted small">
        If the pop-up title says “Light Show” instead of “Custom Light Show”, the car didn't accept the drive: check the format,
        the folder name and that the file names match. If the files are found but something's wrong inside, the car shows an
        error message.
      </p>
    </Dialog>
  );
}

interface ExportProps {
  defaultName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  errors: number;
  hasAudio: boolean;
  format: (ms: number) => string;
  onUsb: (name: string) => Promise<void>;
  onFseq: (name: string) => void;
  onResetRange: () => void;
  onHelp: () => void;
  onClose: () => void;
}

export function ExportDialog(p: ExportProps) {
  const [name, setName] = useState(p.defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const whole = p.startMs === 0 && p.endMs >= p.durationMs;

  async function usb() {
    setBusy(true);
    setError(undefined);
    try {
      await p.onUsb(name);
      p.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Export" onClose={p.onClose}>
      <label className="stacked">
        <span>Show name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <span className="muted small">Shown in the car's Light Show menu. Letters, numbers, - and _ are kept.</span>
      </label>
      <p>
        Exporting{' '}
        <strong>
          {p.format(p.startMs)} – {p.format(p.endMs)}
        </strong>{' '}
        ({p.format(p.endMs - p.startMs)}){whole ? ', the whole song.' : ' of the song.'}{' '}
        {!whole && (
          <button className="link" onClick={p.onResetRange}>
            Use the whole song
          </button>
        )}
      </p>
      <p className="muted small">To export a different part, close this and drag the red handles above the waveform.</p>
      {p.errors > 0 && <p className="error-text">This show has {p.errors} problem(s) that will stop it from playing. See the checks button.</p>}
      {!p.hasAudio && <p className="warn-text">There's no music loaded, so the zip will only contain the show file. Tesla needs both.</p>}
      {error && <p className="error-text">Export failed: {error}</p>}
      <div className="modal-actions">
        <button className="primary" onClick={() => void usb()} disabled={busy}>
          {busy ? 'Preparing…' : 'Download for USB (.zip)'}
        </button>
        <button onClick={() => p.onFseq(name)} disabled={busy}>
          Show file only (.fseq)
        </button>
        <button className="icon help" onClick={p.onHelp} aria-label="How to put this on a USB drive" title="How to put this on a USB drive">
          ?
        </button>
      </div>
      <p className="muted small">
        You can export at any time, finished or not. The <code>.fseq</code> file holds the whole show, so you can open it here again
        later (with its music) to keep working.
      </p>
    </Dialog>
  );
}
