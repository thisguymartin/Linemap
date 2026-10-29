import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { withViewTransition } from '../motion';
import { api, fmtWhen, type VersionMeta } from '../api';
import { Icon } from '../icons';
import { useUnread, useWorkspace } from '../workspace';

interface Props {
  diagramId: string;
  elementCount: number;
  focusTick: number;
}

export function VersionsTab({ diagramId, elementCount, focusTick }: Props): ReactElement {
  const { eventTick, toast } = useWorkspace();
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [confirmNow, setConfirmNow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; action: 'restore' | 'delete' } | null>(null);
  const ownIds = useRef(new Set<string>());
  const labelRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.versions(diagramId).then(list => { if (cancelled) return; withViewTransition(() => flushSync(() => { setVersions(list); setLoading(false); })); }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [diagramId, eventTick.version_changed]);

  useEffect(() => {
    if (focusTick > 0) labelRef.current?.focus();
  }, [focusTick]);

  const ids = useMemo(() => versions.map(v => v.id), [versions]);
  const { unread, markRead } = useUnread(ids, ownIds.current);

  const save = async (): Promise<void> => {
    setBusy('save');
    try {
      const version = await api.saveVersion(diagramId, { label: label.trim() || undefined, note: note.trim() || undefined, author: 'human', confirm: confirmNow });
      ownIds.current.add(version.id);
      setLabel('');
      setNote('');
      setShowNote(false);
      setConfirmNow(false);
      toast(`Saved v${version.number}${version.confirmed ? ' and confirmed' : ''}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleConfirm = async (version: VersionMeta): Promise<void> => {
    setBusy(version.id);
    try {
      await api.updateVersion(version.id, { confirmed: !version.confirmed });
      toast(version.confirmed ? `v${version.number} unconfirmed` : `v${version.number} confirmed`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const restore = async (version: VersionMeta): Promise<void> => {
    setBusy(version.id);
    setPending(null);
    try {
      await api.restoreVersion(version.id, elementCount > 0 ? `before restoring v${version.number}` : undefined);
      toast(`Restored v${version.number} onto the canvas`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (version: VersionMeta): Promise<void> => {
    setBusy(version.id);
    setPending(null);
    try {
      await api.deleteVersion(version.id);
      toast(`Deleted v${version.number}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="panel-section">
        <form className="save-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="row">
            <input
              ref={labelRef}
              className="input"
              placeholder={`Label for v${(versions[0]?.number ?? 0) + 1} (optional)`}
              value={label}
              onChange={e => setLabel(e.target.value)}
              aria-label="Version label"
            />
            <button type="submit" className={`btn btn-primary ${busy === 'save' ? 'is-busy' : ''}`} disabled={busy !== null || elementCount === 0} title={elementCount === 0 ? 'Draw something first' : 'Save a numbered version of the canvas'}>
              <Icon name="save" /> Save
            </button>
          </div>
          {showNote ? (
            <textarea className="textarea" placeholder="What changed and why" value={note} onChange={e => setNote(e.target.value)} aria-label="Version note" />
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowNote(true)}>
              <Icon name="edit" /> Add a note
            </button>
          )}
          <label className="check">
            <input type="checkbox" checked={confirmNow} onChange={e => setConfirmNow(e.target.checked)} /> Confirm this version now
          </label>
        </form>
      </div>

      {loading ? (
        <p className="empty">Loading versions…</p>
      ) : versions.length === 0 ? (
        <p className="empty"><strong>No versions yet</strong>The canvas autosaves on its own. Save a version when you reach a state worth coming back to, then confirm it once you have checked it.</p>
      ) : (
        <ol className="stops" aria-label="Saved versions, newest first">
          {versions.map(version => {
            const isPending = pending?.id === version.id;
            return (
              <li
                key={version.id}
                className="stop"
                data-confirmed={version.confirmed ? 'true' : 'false'}
                data-new={unread.has(version.id) ? 'true' : 'false'}
                onMouseEnter={() => markRead(version.id)}
                onFocus={() => markRead(version.id)}
                style={{ viewTransitionName: `stop-${version.id.replace(/[^a-z0-9]/gi, '')}` }}
              >
                <div className="rail"><span className="station" aria-hidden="true" /></div>
                <div>
                  <div className="v">
                    v{version.number}
                    <span className="label" title={version.label}>{version.label !== `v${version.number}` ? version.label : ''}</span>
                    {version.confirmed
                      ? <span className="pill pill-ok"><Icon name="check" size={11} /> confirmed</span>
                      : <span className="pill pill-warn">unconfirmed</span>}
                  </div>
                  <div className="meta">
                    <span>{version.author}</span>
                    <time dateTime={version.createdAt} title={new Date(version.createdAt).toLocaleString()}>{fmtWhen(version.createdAt)}</time>
                    <span>{version.elementCount} el</span>
                  </div>
                  {version.note && <div className="stop-note">{version.note}</div>}
                  {isPending && (
                    <div className="confirm-inline" style={{ marginTop: 6 }}>
                      <span>{pending.action === 'restore' ? `Replace the canvas with v${version.number}?` : `Delete v${version.number} for good?`}</span>
                      <button type="button" className={`btn btn-sm ${pending.action === 'delete' ? 'btn-danger' : 'btn-primary'}`} onClick={() => void (pending.action === 'restore' ? restore(version) : remove(version))}>
                        {pending.action === 'restore' ? 'Restore' : 'Delete'}
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPending(null)}>Cancel</button>
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button type="button" className={`btn btn-ghost btn-sm btn-icon ${busy === version.id ? 'is-busy' : ''}`} title={version.confirmed ? 'Unconfirm' : 'Confirm this version'} aria-label={version.confirmed ? `Unconfirm v${version.number}` : `Confirm v${version.number}`} aria-pressed={version.confirmed} onClick={() => void toggleConfirm(version)} disabled={busy !== null}>
                    <Icon name="check" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Restore onto the canvas" aria-label={`Restore v${version.number}`} onClick={() => setPending({ id: version.id, action: 'restore' })} disabled={busy !== null}>
                    <Icon name="restore" />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm btn-icon btn-danger" title="Delete this version" aria-label={`Delete v${version.number}`} onClick={() => setPending({ id: version.id, action: 'delete' })} disabled={busy !== null}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
