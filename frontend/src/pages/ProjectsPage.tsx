import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { api, diagramPath, fmtWhen, parseTags, projectPath, type ProjectSummary } from '../api';
import { Icon } from '../icons';
import { navigate, onLinkClick } from '../router';
import { useWorkspace } from '../workspace';
import { applyRoute, routeStyle } from '../color';
import { FolderPicker } from '../components/FolderPicker';

export function ProjectsPage(): ReactElement {
  const { activeDiagramId, activeProjectId, toast, theme, setTheme, eventTick } = useWorkspace();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [folder, setFolder] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Projects · Linemap';
    applyRoute(null, theme);
    void api.projects().then(setProjects).catch(error => toast((error as Error).message, 'error'));
  }, [toast, theme, eventTick.project_changed, eventTick.diagram_changed]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await api.createProject({ name: name.trim(), description: description.trim() || undefined, tags: parseTags(tags), rootPath: folder.trim() || undefined });
      const { diagram } = await api.createDiagram(project.id, { name: 'Overview', open: true });
      navigate(diagramPath(project.id, diagram.id));
    } catch (error) {
      toast((error as Error).message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left"><span className="route-chip" style={{ cursor: 'default' }}><Icon name="map" /> <span className="name">Linemap</span></span></div>
        <div className="topbar-center" />
        <div className="topbar-right">
          {activeProjectId && activeDiagramId && (
            <a className="btn" href={diagramPath(activeProjectId, activeDiagramId)} onClick={onLinkClick}><Icon name="arrow" /> Back to canvas</a>
          )}
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Day theme' : 'Night theme'} aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>
      <main className="page scroll">
        <div className="page-inner">
          <div className="page-head">
            <div>
              <h1>Projects</h1>
              <p className="sub">One line per domain you are thinking through. Each project keeps its diagrams, versions, notes and links together so an agent can pick it up cold.</p>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-primary" aria-pressed={showNew} onClick={() => setShowNew(s => !s)}><Icon name="plus" /> New project</button>
            </div>
          </div>

          <form className="inline-form" data-open={showNew ? 'true' : 'false'} onSubmit={e => { e.preventDefault(); void create(); }}>
            <label className="field"><span>Project name</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Water heater" autoFocus={showNew} /></label>
            <label className="field"><span>Tags</span><input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="hvac, plumbing" /></label>
            <button type="submit" className={`btn btn-primary ${busy ? 'is-busy' : ''}`} disabled={busy || !name.trim()}>Create with an Overview diagram</button>
            <div className="field wide">
              <span>Local folder (optional)</span>
              <div className="input-row">
                <input className="input" value={folder} onChange={e => setFolder(e.target.value)} placeholder="~/code/water-heater" spellCheck={false} aria-label="Local folder" />
                <button type="button" className="btn" aria-pressed={picking} onClick={() => setPicking(p => !p)}><Icon name="folder" /> Browse</button>
              </div>
              {picking && <FolderPicker initialPath={folder || undefined} onPick={path => { setFolder(path); setPicking(false); }} onCancel={() => setPicking(false)} pickLabel="Choose" />}
            </div>
            <label className="field wide"><span>What is this about?</span><textarea className="textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="One paragraph of context. Agents read this before touching the canvas." /></label>
          </form>

          {projects === null ? (
            <p className="empty">Loading projects…</p>
          ) : projects.length === 0 ? (
            <p className="empty"><strong>No projects yet</strong>Create one to start a line.</p>
          ) : (
            <div className="legend" role="list">
              {projects.map(p => (
                <a key={p.id} role="listitem" className="legend-row" href={projectPath(p.id)} onClick={onLinkClick} style={routeStyle(p.color, theme) as CSSProperties}>
                  <span className="line" aria-hidden="true">
                    {Array.from({ length: Math.min(p.diagramCount, 4) }).map((_, i) => <i key={i} style={{ left: `${(i + 1) * (100 / (Math.min(p.diagramCount, 4) + 1))}%` }} />)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="title">{p.name}{p.id === activeProjectId && <span className="pill pill-route">on canvas</span>}{p.tags.length > 0 && <span className="tags">{p.tags.map(t => <span key={t} className="tag">#{t}</span>)}</span>}</span>
                    {p.description && <span className="desc" style={{ display: 'block' }}>{p.description}</span>}
                  </span>
                  <span className="stats">
                    <span><b>{p.diagramCount}</b> diagram{p.diagramCount === 1 ? '' : 's'}</span>
                    <span><b>{p.noteCount}</b> note{p.noteCount === 1 ? '' : 's'}</span>
                    <span>{fmtWhen(p.updatedAt)}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
