import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { api, diagramPath, fmtWhen, parseTags, projectPath, type DiagramMeta, type Link, type Note, type ProjectDetail } from '../api';
import { Icon } from '../icons';
import { navigate } from '../router';
import { useWorkspace } from '../workspace';

export interface SelectedElementInfo {
  id: string;
  type: string;
  label: string;
  tags: string[];
  note: string;
  link: string | null;
}

interface Props {
  project: ProjectDetail | null;
  diagram: DiagramMeta | null;
  selected: SelectedElementInfo[];
  links: Link[];
  labelFor: (elementId: string) => string;
  onFocusElement: (elementId: string) => void;
  onClearCanvas: () => void;
  canClear: boolean;
  openNotes: Note[];
  onOpenNotes: () => void;
}

function TagEditor({ tags, onChange, placeholder }: { tags: string[]; onChange: (tags: string[]) => void; placeholder: string }): ReactElement {
  const [draft, setDraft] = useState('');
  const commit = (): void => {
    const next = parseTags(draft);
    if (next.length === 0) return;
    onChange([...new Set([...tags, ...next])]);
    setDraft('');
  };
  return (
    <div className="tag-editor">
      {tags.map(tag => (
        <button key={tag} type="button" className="chip chip-tag" onClick={() => onChange(tags.filter(t => t !== tag))} title="Remove tag">
          #{tag} <Icon name="x" size={10} />
        </button>
      ))}
      <input
        className="input"
        placeholder={placeholder}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        aria-label={placeholder}
      />
    </div>
  );
}

export function ContextTab({ project, diagram, selected, links, labelFor, onFocusElement, onClearCanvas, canClear, openNotes, onOpenNotes }: Props): ReactElement {
  const { toast } = useWorkspace();
  const [elementNote, setElementNote] = useState('');
  const [description, setDescription] = useState(diagram?.description ?? '');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkRelation, setLinkRelation] = useState('drills-into');
  const [linkFromShape, setLinkFromShape] = useState(true);
  const [copying, setCopying] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A question is a note that says so (#question) or asks one; answers and statements stay in the thread.
  const questions = useMemo(() => openNotes.filter(n => n.tags.includes('question') || /\?\s*$/m.test(n.body.trim())), [openNotes]);
  const single = selected.length === 1 ? selected[0] : null;
  const selectedIds = useMemo(() => selected.map(s => s.id), [selected]);
  const sharedTags = useMemo(() => {
    if (selected.length === 0) return [];
    return selected[0].tags.filter(tag => selected.every(s => s.tags.includes(tag)));
  }, [selected]);

  useEffect(() => { setElementNote(single?.note ?? ''); }, [single?.id, single?.note]);
  useEffect(() => { setDescription(diagram?.description ?? ''); }, [diagram?.id, diagram?.description]);

  const siblings = (project?.diagrams ?? []).filter(d => d.id !== diagram?.id);
  useEffect(() => {
    if (!linkTarget && siblings[0]) setLinkTarget(siblings[0].id);
  }, [siblings, linkTarget]);

  const setTags = async (tags: string[]): Promise<void> => {
    if (selectedIds.length === 0) return;
    try {
      if (selectedIds.length === 1) await api.tagElements({ elementIds: selectedIds, tags });
      else {
        const removed = sharedTags.filter(t => !tags.includes(t));
        const added = tags.filter(t => !sharedTags.includes(t));
        await api.tagElements({ elementIds: selectedIds, addTags: added, removeTags: removed });
      }
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const saveElementNote = (value: string): void => {
    setElementNote(value);
    if (!single) return;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      void api.tagElements({ elementIds: [single.id], note: value }).catch(error => toast((error as Error).message, 'error'));
    }, 600);
  };

  const saveDescription = async (): Promise<void> => {
    if (!diagram || description === diagram.description) return;
    try {
      await api.updateDiagram(diagram.id, { description });
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const addLink = async (): Promise<void> => {
    if (!project || !diagram || !linkTarget) return;
    try {
      const fromElementId = linkFromShape && single ? single.id : undefined;
      await api.createLink(project.id, {
        from: { diagramId: diagram.id, ...(fromElementId ? { elementId: fromElementId } : {}) },
        to: { diagramId: linkTarget },
        relation: linkRelation.trim() || 'relates-to'
      });
      if (fromElementId) await api.updateElement(fromElementId, { link: diagramPath(project.id, linkTarget) });
      toast('Linked');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const removeLink = async (link: Link): Promise<void> => {
    try {
      await api.deleteLink(link.id);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const copyBrain = async (): Promise<void> => {
    if (!project) return;
    setCopying(true);
    try {
      const markdown = await api.projectContext(project.id);
      await navigator.clipboard.writeText(markdown);
      toast('Project context copied. Paste it to any agent.');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCopying(false);
    }
  };

  const outgoing = links.filter(l => l.from.diagramId === diagram?.id);
  const incoming = links.filter(l => l.to.diagramId === diagram?.id && l.from.diagramId !== diagram?.id);
  const nameOf = (id: string): string => project?.diagrams.find(d => d.id === id)?.name ?? id;

  return (
    <div className="panel-body scroll">
      <section className="panel-section" aria-labelledby="ctx-selection">
        <div className="section-head"><h3 id="ctx-selection">Selection</h3>{selected.length > 0 && <span className="small muted">{selected.length} shape{selected.length === 1 ? '' : 's'}</span>}</div>
        {selected.length === 0 ? (
          <p className="small muted">Select a shape on the canvas to tag it, note it, or link it to another diagram.</p>
        ) : (
          <>
            {single ? (
              <dl className="kv" style={{ marginBottom: 10 }}>
                <dt>Label</dt><dd>{single.label}</dd>
                <dt>Type</dt><dd>{single.type}</dd>
                <dt>Id</dt><dd><code>{single.id}</code></dd>
                {single.link && <><dt>Link</dt><dd><button type="button" className="to" style={{ background: 'none', border: 0, padding: 0, color: 'var(--route)', cursor: 'pointer' }} onClick={() => single.link && navigate(single.link)}>{single.link}</button></dd></>}
              </dl>
            ) : (
              <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {selected.map(s => <button key={s.id} type="button" className="chip" onClick={() => onFocusElement(s.id)}>{s.label}</button>)}
              </div>
            )}
            <div className="field" style={{ marginBottom: 10 }}>
              <span>Tags{selected.length > 1 ? ' (shared)' : ''}</span>
              <TagEditor tags={sharedTags} onChange={tags => void setTags(tags)} placeholder="add tag" />
            </div>
            {single && (
              <label className="field">
                <span>Note on this shape</span>
                <textarea className="textarea" value={elementNote} onChange={e => saveElementNote(e.target.value)} placeholder="What this is, why it matters…" />
              </label>
            )}
          </>
        )}
      </section>

      <section className="panel-section" aria-labelledby="ctx-questions">
        <div className="section-head"><h3 id="ctx-questions">Open questions</h3>{questions.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenNotes}>Answer in Notes</button>}</div>
        {questions.length === 0 ? (
          <p className="small muted">Nothing open. Unresolved notes tagged #question, or that ask one, show here.</p>
        ) : (
          <ul className="links-list">
            {questions.slice(-3).map(note => (
              <li key={note.id} style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 4 }}>
                <span className="small" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Icon name={note.role === 'agent' ? 'bot' : 'user'} size={12} className="muted" />
                  <b>{note.author}</b>
                  <span className="muted">{fmtWhen(note.createdAt)}</span>
                </span>
                <span style={{ color: 'var(--ink)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{note.body}</span>
                {note.elementIds.length > 0 && (
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {note.elementIds.map(id => <button key={id} type="button" className="chip" onClick={() => onFocusElement(id)}><Icon name="locate" size={11} /> {labelFor(id)}</button>)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section" aria-labelledby="ctx-links">
        <div className="section-head"><h3 id="ctx-links">Links</h3></div>
        {outgoing.length + incoming.length === 0 && <p className="small muted" style={{ marginBottom: 8 }}>No links yet. Link a shape to the diagram that explains it; clicking the shape then jumps there.</p>}
        <ul className="links-list">
          {outgoing.map(link => (
            <li key={link.id}>
              {link.from.elementId && <button type="button" className="chip" onClick={() => onFocusElement(link.from.elementId!)}>{labelFor(link.from.elementId)}</button>}
              <span className="rel">{link.relation}</span>
              <Icon name="arrow" size={12} className="muted" />
              <button type="button" className="to" onClick={() => project && navigate(diagramPath(project.id, link.to.diagramId))}>{nameOf(link.to.diagramId)}</button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon del" aria-label="Remove link" onClick={() => void removeLink(link)}><Icon name="x" size={12} /></button>
            </li>
          ))}
          {incoming.map(link => (
            <li key={link.id}>
              <button type="button" className="to" onClick={() => project && navigate(diagramPath(project.id, link.from.diagramId))}>{nameOf(link.from.diagramId)}</button>
              <span className="rel">{link.relation}</span>
              <Icon name="arrow" size={12} className="muted" />
              <span>here</span>
              <button type="button" className="btn btn-ghost btn-sm btn-icon del" aria-label="Remove link" onClick={() => void removeLink(link)}><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
        {siblings.length > 0 ? (
          <form className="link-form" onSubmit={e => { e.preventDefault(); void addLink(); }}>
            <div className="input-row">
              <label className="field"><span>To diagram</span>
                <select className="select" value={linkTarget} onChange={e => setLinkTarget(e.target.value)}>
                  {siblings.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Relation</span>
                <input className="input" value={linkRelation} onChange={e => setLinkRelation(e.target.value)} placeholder="drills-into" />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <label className="check" title={single ? `Link starts at "${single.label}"` : 'Select exactly one shape to link from it'}>
                <input type="checkbox" checked={linkFromShape && !!single} disabled={!single} onChange={e => setLinkFromShape(e.target.checked)} /> From selected shape
              </label>
              <button type="submit" className="btn btn-sm"><Icon name="link" size={12} /> Add link</button>
            </div>
          </form>
        ) : (
          <p className="small muted" style={{ marginTop: 8 }}>Create a second diagram in this project to link to it.</p>
        )}
      </section>

      <section className="panel-section" aria-labelledby="ctx-diagram">
        <div className="section-head"><h3 id="ctx-diagram">This diagram</h3></div>
        <label className="field description-edit">
          <span>Description</span>
          <textarea className="textarea" value={description} onChange={e => setDescription(e.target.value)} onBlur={() => void saveDescription()} placeholder="What this diagram shows, in a sentence or two. Agents read this first." />
        </label>
        <div className="field" style={{ marginTop: 10 }}>
          <span>Diagram tags</span>
          <TagEditor tags={diagram?.tags ?? []} onChange={tags => diagram && void api.updateDiagram(diagram.id, { tags }).catch(error => toast((error as Error).message, 'error'))} placeholder="add tag" />
        </div>
        <div style={{ marginTop: 12 }}>
          {confirmClear ? (
            <span className="confirm-inline">
              <span>Remove every shape from this diagram? Saved versions stay.</span>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirmClear(false); onClearCanvas(); }}>Clear</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmClear(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmClear(true)} disabled={!canClear}>
              <Icon name="trash" size={12} /> Clear canvas
            </button>
          )}
        </div>
      </section>

      <section className="panel-section" aria-labelledby="ctx-project">
        <div className="section-head"><h3 id="ctx-project">Project</h3></div>
        {project && (
          <>
            <p style={{ fontWeight: 600 }}>{project.name}</p>
            {project.description && <p className="small muted" style={{ marginTop: 2 }}>{project.description}</p>}
            <p className="small" style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center', color: 'var(--ink-2)' }}>
              <Icon name={project.folder?.git?.isRepo ? 'branch' : 'folder'} size={12} />
              {project.folder?.rootPath
                ? <span title={project.folder.rootPath}>{project.folder.display}{project.folder.git?.branch ? ` · ${project.folder.git.branch}` : ''}{project.folder.exists ? '' : ' (missing)'}</span>
                : <span className="muted">No folder linked</span>}
            </p>
            <p className="small muted" style={{ marginTop: 6 }}>{project.diagrams.length} diagrams · {project.linkCount} links · {project.noteCount} notes</p>
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" onClick={() => navigate(projectPath(project.id))}><Icon name="map" size={12} /> Open map</button>
              <button type="button" className={`btn btn-sm ${copying ? 'is-busy' : ''}`} onClick={() => void copyBrain()} title="Copy the project context digest for an agent"><Icon name="copy" size={12} /> Copy context</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
