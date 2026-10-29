import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { api, diagramPath, fmtWhen, parseTags, type Note } from '../api';
import { Icon } from '../icons';
import { navigate, onLinkClick } from '../router';
import { useSiblingDiagrams, useWorkspace } from '../workspace';
import { TransitMap, MapKey } from '../components/TransitMap';
import { FolderRow } from '../components/FolderRow';
import { Markdown } from '../components/Markdown';
import { applyRoute } from '../color';

export function ProjectPage({ projectId }: { projectId: string }): ReactElement {
  const { project, loadProject, activeDiagramId, toast, theme, setTheme, eventTick } = useWorkspace();
  const [missing, setMissing] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', description: '', tags: '' });
  const [notes, setNotes] = useState<Note[]>([]);
  const [context, setContext] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDiagramDelete, setPendingDiagramDelete] = useState<string | null>(null);

  useEffect(() => {
    void loadProject(projectId).then(detail => setMissing(detail === null));
  }, [projectId, loadProject]);

  useEffect(() => {
    if (!project || project.id !== projectId) return;
    applyRoute(project.color, theme);
    document.title = `${project.name} · Linemap`;
    setDraft({ name: project.name, description: project.description, tags: project.tags.join(', ') });
  }, [project, projectId, theme]);

  // The marker rides the line once on arrival and again when a diagram autosaves.
  const [markerKey, setMarkerKey] = useState(0);
  useEffect(() => { setMarkerKey(k => k + 1); }, [projectId, eventTick.diagram_saved]);

  useEffect(() => {
    void api.notes(projectId).then(setNotes).catch(() => setNotes([]));
  }, [projectId, eventTick.note_changed]);

  useEffect(() => {
    setContext(null);
  }, [projectId, eventTick.note_changed, eventTick.diagram_changed, eventTick.link_changed, eventTick.version_changed]);

  const diagrams = useSiblingDiagrams(project?.id === projectId ? project : null);
  const openNotes = useMemo(() => notes.filter(n => !n.resolved && n.role === 'human'), [notes]);
  const agentNotes = useMemo(() => notes.filter(n => !n.resolved && n.role === 'agent'), [notes]);

  const open = (diagramId: string): void => navigate(diagramPath(projectId, diagramId));

  const createDiagram = async (): Promise<void> => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const { diagram } = await api.createDiagram(projectId, { name: newName.trim(), description: newDescription.trim() || undefined, open: true });
      setNewName('');
      setNewDescription('');
      setShowNew(false);
      navigate(diagramPath(projectId, diagram.id));
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveProject = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.updateProject(projectId, { name: draft.name.trim() || undefined, description: draft.description, tags: parseTags(draft.tags) });
      await loadProject(projectId);
      setEditing(false);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const deleteProject = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.deleteProject(projectId);
      toast('Project deleted');
      if (result.activeProjectId && result.activeDiagramId) navigate(diagramPath(result.activeProjectId, result.activeDiagramId), { replace: true });
      else navigate('/projects', { replace: true });
    } catch (error) {
      toast((error as Error).message, 'error');
      setBusy(false);
    }
  };

  const deleteDiagram = async (diagramId: string): Promise<void> => {
    setPendingDiagramDelete(null);
    try {
      await api.deleteDiagram(diagramId);
      await loadProject(projectId);
      toast('Diagram deleted');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const loadContext = async (): Promise<void> => {
    if (context !== null) return;
    try {
      setContext(await api.projectContext(projectId));
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const copyContext = async (): Promise<void> => {
    try {
      const markdown = context ?? await api.projectContext(projectId);
      setContext(markdown);
      await navigator.clipboard.writeText(markdown);
      toast('Project context copied. Paste it to any agent.');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  if (missing) {
    return (
      <div className="app">
        <header className="topbar"><div className="topbar-left"><a className="route-chip" href="/projects" onClick={onLinkClick}><Icon name="list" /> Projects</a></div></header>
        <div className="page"><div className="page-inner"><p className="empty"><strong>Project not found</strong>It may have been deleted. <a href="/projects" onClick={onLinkClick} style={{ color: 'var(--route)' }}>Back to projects</a></p></div></div>
      </div>
    );
  }

  const current = project?.id === projectId ? project : null;
  const activeHere = current?.diagrams.find(d => d.id === activeDiagramId) ?? null;
  const first = diagrams[0] ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <a className="route-chip" href="/projects" onClick={onLinkClick} title="All projects"><Icon name="list" /> Projects</a>
          <span className="crumb-sep" aria-hidden="true"><Icon name="chevron" size={12} /></span>
          <span className="route-chip" style={{ cursor: 'default' }} title={current?.name} aria-label={current?.name}><span className="route-swatch" aria-hidden="true" /><span className="name">{current?.name ?? '…'}</span></span>
        </div>
        <div className="topbar-center" />
        <div className="topbar-right">
          {(activeHere ?? first) && (
            <button type="button" className="btn btn-primary" onClick={() => open((activeHere ?? first)!.id)}>
              <Icon name="arrow" /> {activeHere ? `Back to ${activeHere.name}` : `Open ${first!.name}`}
            </button>
          )}
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Day theme' : 'Night theme'} aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <main className="page scroll">
        <div className="page-inner">
          <div className="page-head">
            <div style={{ minWidth: 0, flex: 1 }}>
              {editing ? (
                <form className="save-form" onSubmit={e => { e.preventDefault(); void saveProject(); }} style={{ maxWidth: 560 }}>
                  <input className="input" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} aria-label="Project name" />
                  <textarea className="textarea" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="What this project is about. Agents read this first." aria-label="Project description" />
                  <input className="input" value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} placeholder="tags, comma separated" aria-label="Project tags" />
                  <div className="row">
                    <button type="submit" className={`btn btn-primary ${busy ? 'is-busy' : ''}`} disabled={busy}>Save</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <h1>{current?.name ?? '…'}</h1>
                  {current?.description && <p className="sub">{current.description}</p>}
                  {current && current.tags.length > 0 && <div className="tags" style={{ marginTop: 8 }}>{current.tags.map(t => <span key={t} className="tag">#{t}</span>)}</div>}
                </>
              )}
            </div>
            {!editing && (
              <div className="actions">
                <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Edit</button>
                <button type="button" className="btn" onClick={() => void copyContext()} title="Copy the project context digest for an agent"><Icon name="copy" /> Copy context</button>
                <button type="button" className="btn" aria-pressed={showNew} onClick={() => setShowNew(s => !s)}><Icon name="plus" /> New diagram</button>
              </div>
            )}
          </div>

          {current && !editing && <FolderRow project={current} />}

          <form className="inline-form" data-open={showNew ? 'true' : 'false'} onSubmit={e => { e.preventDefault(); void createDiagram(); }}>
            <label className="field"><span>Diagram name</span><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Burner assembly" autoFocus={showNew} /></label>
            <label className="field"><span>Description (optional)</span><input className="input" value={newDescription} onChange={e => setNewDescription(e.target.value)} placeholder="What it shows" /></label>
            <button type="submit" className={`btn btn-primary ${busy ? 'is-busy' : ''}`} disabled={busy || !newName.trim()}>Create and open</button>
          </form>

          <div className="map-wrap">
            {diagrams.length === 0 ? (
              <p className="empty" style={{ padding: 40, textAlign: 'center' }}><strong>No stations on this line yet</strong>Create the first diagram and it appears here as a station. Links between diagrams draw as interchanges.</p>
            ) : (
              <TransitMap diagrams={diagrams} links={current?.links ?? []} activeId={activeDiagramId} onOpen={open} markerKey={markerKey} />
            )}
            <div className="map-foot">
              <span>{diagrams.length} station{diagrams.length === 1 ? '' : 's'} · {current?.links.length ?? 0} interchange{current?.links.length === 1 ? '' : 's'}</span>
              <MapKey />
            </div>
          </div>

          <div className="two-col">
            <section aria-labelledby="stations-h">
              <div className="section-head"><h3 id="stations-h">Stations</h3></div>
              <table className="table">
                <thead><tr><th>Diagram</th><th className="num">Elements</th><th>Version</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {diagrams.map(d => (
                    <tr key={d.id} data-active={d.id === activeDiagramId ? 'true' : 'false'}>
                      <td>
                        <button type="button" className="rowbtn" onClick={() => open(d.id)}>{d.name}</button>
                        {d.description && <div className="muted small">{d.description}</div>}
                        {d.tags.length > 0 && <div className="tags" style={{ marginTop: 2 }}>{d.tags.map(t => <span key={t} className="tag">#{t}</span>)}</div>}
                      </td>
                      <td className="num">{d.elementCount}</td>
                      <td>
                        {d.latestVersion
                          ? <span className={`pill ${d.latestConfirmedVersion === d.latestVersion ? 'pill-ok' : 'pill-warn'}`}>v{d.latestVersion}{d.latestConfirmedVersion === d.latestVersion && <Icon name="check" size={11} />}</span>
                          : <span className="muted">none</span>}
                      </td>
                      <td className="muted">{fmtWhen(d.updatedAt)}</td>
                      <td className="num">
                        {pendingDiagramDelete === d.id ? (
                          <span className="confirm-inline">
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => void deleteDiagram(d.id)}>Delete</button>
                            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPendingDiagramDelete(null)}>Cancel</button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-ghost btn-sm btn-icon btn-danger" aria-label={`Delete ${d.name}`} title="Delete diagram" onClick={() => setPendingDiagramDelete(d.id)}><Icon name="trash" size={12} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {current && current.links.length > 0 && (
                <>
                  <div className="section-head" style={{ marginTop: 24 }}><h3>Interchanges</h3></div>
                  <table className="table">
                    <thead><tr><th>From</th><th>Relation</th><th>To</th></tr></thead>
                    <tbody>
                      {current.links.map(l => {
                        const from = current.diagrams.find(d => d.id === l.from.diagramId);
                        const to = current.diagrams.find(d => d.id === l.to.diagramId);
                        return (
                          <tr key={l.id}>
                            <td><button type="button" className="rowbtn" onClick={() => open(l.from.diagramId)}>{from?.name ?? l.from.diagramId}</button>{l.from.elementId && <span className="muted"> › shape</span>}</td>
                            <td className="muted">{l.relation}</td>
                            <td><button type="button" className="rowbtn" onClick={() => open(l.to.diagramId)}>{to?.name ?? l.to.diagramId}</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </section>

            <section aria-labelledby="conv-h">
              <div className="section-head"><h3 id="conv-h">Conversation</h3><span className="small muted">{notes.length} notes</span></div>
              {openNotes.length === 0 && agentNotes.length === 0 ? (
                <p className="small muted">No open notes. Open a diagram and leave one on a shape; agents answer in the same thread.</p>
              ) : (
                <ol className="thread" style={{ border: '1px solid var(--rule)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginBottom: 16 }}>
                  {[...agentNotes, ...openNotes].slice(-8).map(n => (
                    <li key={n.id} className="note" data-role={n.role}>
                      <span className="avatar" aria-hidden="true"><Icon name={n.role === 'agent' ? 'bot' : 'user'} size={14} /></span>
                      <div>
                        <div className="head"><span className="who">{n.author}</span>{n.diagramId && <button type="button" className="rowbtn muted" onClick={() => open(n.diagramId!)}>{current?.diagrams.find(d => d.id === n.diagramId)?.name ?? 'diagram'}</button>}<time dateTime={n.createdAt}>{fmtWhen(n.createdAt)}</time></div>
                        <div className="body"><Markdown text={n.body} /></div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}

              <details className="brain" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) void loadContext(); }}>
                <summary><span><Icon name="bot" /> What an agent reads</span><span className="small muted">context digest</span></summary>
                <pre>{context ?? 'Loading…'}</pre>
              </details>
            </section>
          </div>

          <div className="danger-zone">
            <span>Deleting this project removes every diagram, version, note and link in it.</span>
            {confirmDelete ? (
              <>
                <button type="button" className={`btn btn-sm btn-danger ${busy ? 'is-busy' : ''}`} onClick={() => void deleteProject()} disabled={busy}>Yes, delete “{current?.name}”</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={12} /> Delete project</button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
