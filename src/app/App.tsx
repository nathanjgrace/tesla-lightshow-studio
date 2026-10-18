import { useState } from 'react';
import { readFseq, type FseqFile } from '../core/fseq';
import { formatTime, validate, type Issue } from '../core/validate';

interface Loaded {
  name: string;
  show: FseqFile;
  issues: Issue[];
}

export function App() {
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);

  async function open(file: File) {
    setError(undefined);
    setLoaded(undefined);
    try {
      const show = readFseq(new Uint8Array(await file.arrayBuffer()));
      setLoaded({ name: file.name, show, issues: validate(show) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main>
      <h1>Tesla Lightshow Studio</h1>
      <p className="lede">
        Early preview: check a light show file before you put it on a USB drive. Drop in a{' '}
        <code>.fseq</code> file to see what's in it and catch problems the car would reject or ignore.
      </p>

      <label
        className={`drop${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void open(file);
        }}
      >
        <input
          type="file"
          accept=".fseq"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void open(file);
          }}
        />
        Drop a <code>.fseq</code> file here, or click to choose one
      </label>

      {error && <p className="issue error">Couldn't read this file: {error}</p>}
      {loaded && <Report {...loaded} />}
    </main>
  );
}

function Report({ name, show, issues }: Loaded) {
  const errors = issues.filter((i) => i.severity === 'error');
  return (
    <section>
      <h2>{name}</h2>
      <dl>
        <dt>Length</dt>
        <dd>{formatTime(show.frameCount * show.stepTimeMs)}</dd>
        <dt>Frame interval</dt>
        <dd>{show.stepTimeMs} ms</dd>
        <dt>Channels</dt>
        <dd>{show.channelCount}</dd>
        <dt>Format</dt>
        <dd>FSEQ 2.{show.minorVersion}</dd>
      </dl>
      <p className={`verdict ${errors.length ? 'bad' : 'good'}`}>
        {errors.length
          ? `${errors.length} problem${errors.length > 1 ? 's' : ''} will stop this show from playing.`
          : issues.length
            ? 'This show should play, but check the warnings below.'
            : 'No problems found.'}
      </p>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((issue, i) => (
            <li key={i} className={`issue ${issue.severity}`}>
              <span className="when">{issue.timeMs !== undefined ? formatTime(issue.timeMs) : '—'}</span>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
