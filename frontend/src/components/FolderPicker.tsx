import { useEffect, useState, type ReactElement } from 'react';
import { api, type DirListing } from '../api';
import { Icon } from '../icons';

interface Props {
  initialPath?: string | null;
  onPick: (path: string) => void | Promise<void>;
  onCancel: () => void;
  pickLabel?: string;
}

// Browse folders on this machine (served by the canvas server; loopback only)
// and pick one. Typing or pasting a path works too.
export function FolderPicker({ initialPath, onPick, onCancel, pickLabel = 'Use this folder' }: Props): ReactElement {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [draft, setDraft] = useState(initialPath ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (path?: string): Promise<void> => {
    setError(null);
    try {
      const next = await api.dirs(path);
      setListing(next);
      setDraft(next.path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { void load(initialPath ?? undefined); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crumbs = listing ? listing.path.split('/').filter(Boolean).map((part, i, all) => ({ name: part, path: '/' + all.slice(0, i + 1).join('/') })) : [];

  const pick = async (): Promise<void> => {
    if (!listing) return;
    setBusy(true);
    try { await onPick(listing.path); } finally { setBusy(false); }
  };

  return (
    <div className="picker" role="group" aria-label="Choose a folder">
      <form className="picker-path" onSubmit={e => { e.preventDefault(); void load(draft); }}>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => listing?.parent && void load(listing.parent)} disabled={!listing?.parent} aria-label="Parent folder" title="Parent folder"><Icon name="up" /></button>
        <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => void load(listing?.home)} aria-label="Home folder" title="Home folder"><Icon name="home" /></button>
        <input className="input" value={draft} onChange={e => setDraft(e.target.value)} aria-label="Folder path" placeholder="/Users/you/code/project or ~/code/project" spellCheck={false} />
        <button type="submit" className="btn btn-sm">Go</button>
      </form>
      {listing && (
        <nav className="picker-crumbs" aria-label="Current folder">
          <button type="button" onClick={() => void load('/')}>/</button>
          {crumbs.map(c => <span key={c.path}><button type="button" onClick={() => void load(c.path)}>{c.name}</button>/</span>)}
          {listing.isGitRepo && <span className="pill pill-route"><Icon name="branch" size={11} /> git repo</span>}
        </nav>
      )}
      {error && <p className="picker-error" role="alert">{error}</p>}
      <ul className="picker-list scroll">
        {listing?.entries.length === 0 && <li className="muted small" style={{ padding: '8px 10px' }}>No sub-folders.</li>}
        {listing?.entries.map(entry => (
          <li key={entry.path}>
            <button type="button" onClick={() => void load(entry.path)}>
              <Icon name={entry.isGitRepo ? 'branch' : 'folder'} size={14} className={entry.isGitRepo ? 'git' : 'muted'} />
              <span>{entry.name}</span>
            </button>
          </li>
        ))}
        {listing?.truncated && <li className="muted small" style={{ padding: '8px 10px' }}>Showing the first 400 folders. Type a path to go further.</li>}
      </ul>
      <div className="picker-foot">
        <span className="small muted">{listing ? listing.path : 'Loading…'}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn btn-sm btn-primary ${busy ? 'is-busy' : ''}`} onClick={() => void pick()} disabled={!listing || busy}>{pickLabel}</button>
        </span>
      </div>
    </div>
  );
}
