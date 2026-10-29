import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { DiagramMeta } from '../api';
import { Icon } from '../icons';

// The signature move: a project's diagrams as stations on its route line.
// Dot size follows element count on a fixed ramp; the active station wears
// the route-coloured ring; interchanges (linked diagrams) wear a double
// ring; a pulse rides the line when the server autosaves.

export function stationSize(elementCount: number): number {
  if (elementCount === 0) return 8;
  if (elementCount <= 5) return 10;
  if (elementCount <= 30) return 12;
  return 14;
}

interface Props {
  diagrams: DiagramMeta[];
  activeId: string | null;
  interchangeIds: Set<string>;
  pulseKey: number;
  onOpen: (diagramId: string) => void;
  onCreate: (name: string) => Promise<void> | void;
}

export function StationLine({ diagrams, activeId, interchangeIds, pulseKey, onOpen, onCreate }: Props): ReactElement {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(false);
  const [trackWidth, setTrackWidth] = useState(200);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pulseKey === 0) return;
    setTrackWidth(trackRef.current?.offsetWidth ?? 200);
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 950);
    return () => clearTimeout(timer);
  }, [pulseKey]);

  const submit = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setName('');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="station-line" aria-label="Diagrams in this project" data-pulse={pulse ? 'true' : 'false'}>
      <div className="track" ref={trackRef} style={{ ['--track-w' as string]: `${trackWidth}px` }}>
        {diagrams.map((diagram, index) => (
          <span key={diagram.id} style={{ display: 'contents' }}>
            {index > 0 && <span className="seg" aria-hidden="true" />}
            <button
              type="button"
              className="station"
              aria-current={diagram.id === activeId ? 'page' : undefined}
              data-interchange={interchangeIds.has(diagram.id) ? 'true' : 'false'}
              aria-label={`${diagram.name}, ${diagram.elementCount} elements${interchangeIds.has(diagram.id) ? ', linked' : ''}${diagram.id === activeId ? ', on canvas' : ''}`}
              onClick={() => onOpen(diagram.id)}
              style={{ ['--size' as string]: `${stationSize(diagram.elementCount)}px` }}
            >
              <span className="dot" />
              <span className="tip" role="tooltip">{diagram.name} · {diagram.elementCount}</span>
            </button>
          </span>
        ))}
        <span className="train" aria-hidden="true" />
      </div>
      {adding ? (
        <form className="station-new" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <input
            autoFocus
            className="input"
            placeholder="New diagram name"
            aria-label="New diagram name"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setAdding(false); setName(''); } }}
          />
          <button type="submit" className={`btn btn-sm btn-primary ${busy ? 'is-busy' : ''}`} disabled={!name.trim() || busy}>Create</button>
          <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label="Cancel" onClick={() => { setAdding(false); setName(''); }}><Icon name="x" size={12} /></button>
        </form>
      ) : (
        <button type="button" className="btn btn-ghost btn-icon btn-sm add" onClick={() => setAdding(true)} title="New diagram in this project" aria-label="New diagram in this project">
          <Icon name="plus" />
        </button>
      )}
    </nav>
  );
}
