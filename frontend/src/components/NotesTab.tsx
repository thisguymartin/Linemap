import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { withViewTransition } from '../motion';
import { api, fmtWhen, type Note } from '../api';
import { Icon } from '../icons';
import { useUnread, useWorkspace } from '../workspace';
import { Markdown } from './Markdown';

interface Props {
  projectId: string;
  diagramId: string;
  selectedIds: string[];
  labelFor: (elementId: string) => string;
  onFocusElement: (elementId: string) => void;
}

export function NotesTab({ projectId, diagramId, selectedIds, labelFor, onFocusElement }: Props): ReactElement {
  const { eventTick, toast } = useWorkspace();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [anchors, setAnchors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const ownIds = useRef(new Set<string>());
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.notes(projectId).then(list => {
      if (cancelled) return;
      withViewTransition(() => flushSync(() => {
        setNotes(list.filter(n => n.diagramId === diagramId || n.diagramId === null));
        setLoading(false);
      }));
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [projectId, diagramId, eventTick.note_changed]);

  // Follow the selection while the composer is empty; once the user starts
  // typing, the anchors they saw are the anchors they meant.
  useEffect(() => {
    if (body.trim() === '') setAnchors(selectedIds);
  }, [selectedIds, body]);

  const ids = useMemo(() => notes.map(n => n.id), [notes]);
  const { unread, markRead } = useUnread(ids, ownIds.current);
  const visible = showResolved ? notes : notes.filter(n => !n.resolved);
  const resolvedCount = notes.length - notes.filter(n => !n.resolved).length;

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const submit = async (): Promise<void> => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const note = await api.addNote(projectId, { diagramId, body: text, author: 'human', role: 'human', elementIds: anchors });
      ownIds.current.add(note.id);
      setBody('');
      setAnchors(selectedIds);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleResolved = async (note: Note): Promise<void> => {
    try {
      await api.updateNote(note.id, { resolved: !note.resolved });
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const remove = async (note: Note): Promise<void> => {
    try {
      await api.deleteNote(note.id);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="panel-body scroll" ref={bodyRef}>
        {loading ? (
          <p className="empty">Loading notes…</p>
        ) : visible.length === 0 ? (
          <p className="empty"><strong>Start the conversation</strong>Select shapes and write what you want the agent to know or do about them. Agents read these notes before they draw, and answer here.</p>
        ) : (
          <ol className="thread" aria-label="Notes">
            {visible.map(note => (
              <li
                key={note.id}
                className="note"
                data-role={note.role}
                data-new={unread.has(note.id) ? 'true' : 'false'}
                data-resolved={note.resolved ? 'true' : 'false'}
                onMouseEnter={() => markRead(note.id)}
                onFocus={() => markRead(note.id)}
                style={{ viewTransitionName: `note-${note.id.replace(/[^a-z0-9]/gi, '')}` }}
              >
                <span className="avatar" aria-hidden="true"><Icon name={note.role === 'agent' ? 'bot' : 'user'} size={14} /></span>
                <div>
                  <div className="head">
                    <span className="who">{note.author}</span>
                    {note.diagramId === null && <span className="muted">project</span>}
                    {note.resolved && <span className="pill pill-ok">resolved</span>}
                    <time dateTime={note.createdAt} title={new Date(note.createdAt).toLocaleString()}>{fmtWhen(note.createdAt)}</time>
                  </div>
                  <div className="body"><Markdown text={note.body} /></div>
                  {(note.elementIds.length > 0 || note.tags.length > 0) && (
                    <div className="chips">
                      {note.elementIds.map(id => (
                        <button key={id} type="button" className="chip" onClick={() => onFocusElement(id)} title="Show on canvas">
                          <Icon name="locate" size={11} /> {labelFor(id)}
                        </button>
                      ))}
                      {note.tags.map(tag => <span key={tag} className="chip chip-tag">#{tag}</span>)}
                    </div>
                  )}
                  <div className="foot">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleResolved(note)}>
                      <Icon name={note.resolved ? 'reopen' : 'check'} size={12} /> {note.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => void remove(note)}>
                      <Icon name="trash" size={12} /> Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        {resolvedCount > 0 && (
          <div className="panel-section" style={{ borderTop: '1px solid var(--rule)' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowResolved(s => !s)}>
              {showResolved ? 'Hide' : 'Show'} {resolvedCount} resolved
            </button>
          </div>
        )}
      </div>
      <form className="composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="about">
          {anchors.length === 0 ? (
            <span>About this diagram. Select shapes to anchor the note to them.</span>
          ) : (
            <>
              <span>About</span>
              {anchors.map(id => (
                <button key={id} type="button" className="chip" onClick={() => setAnchors(a => a.filter(x => x !== id))} title="Remove from this note">
                  {labelFor(id)} <Icon name="x" size={10} />
                </button>
              ))}
            </>
          )}
        </div>
        <textarea
          className="textarea"
          placeholder="Ask a question, leave a decision, give feedback…"
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          aria-label="New note"
        />
        <div className="foot">
          <span className="hint">⌘↵ to send</span>
          <button type="submit" className={`btn btn-primary btn-sm ${busy ? 'is-busy' : ''}`} disabled={busy || body.trim() === ''}>
            <Icon name="send" size={14} /> Add note
          </button>
        </div>
      </form>
    </>
  );
}
