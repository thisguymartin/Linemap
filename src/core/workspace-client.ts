import { EXPRESS_SERVER_URL } from './config.js';
import type {
  DiagramMeta,
  DiagramScene,
  Link,
  LinkEnd,
  Note,
  ProjectDetail,
  ProjectSummary,
  Version,
  VersionMeta
} from '../domain/model.js';
import type { ServerElement } from '../types.js';

// Typed REST wrappers for the workspace API, shared by the MCP tools and
// the CLI. Refs are forgiving: a project can be named by id, slug or name;
// a diagram by id or name (scoped to a project when one is given, otherwise
// the active project, otherwise any project).

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${EXPRESS_SERVER_URL}${path}`, init);
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.error || `Canvas server error: ${response.status} ${response.statusText}`);
  }
  return data as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  };
}

export interface WorkspaceInfo {
  activeDiagramId: string | null;
  activeProjectId: string | null;
  activeDiagram: DiagramMeta | null;
  dataDir: string;
}

export async function getWorkspace(): Promise<WorkspaceInfo> {
  return requestJson<WorkspaceInfo>('/api/workspace');
}

// ---- projects -------------------------------------------------------------

export async function listProjects(): Promise<ProjectSummary[]> {
  return (await requestJson<{ projects: ProjectSummary[] }>('/api/projects')).projects;
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  return (await requestJson<{ project: ProjectDetail }>(`/api/projects/${encodeURIComponent(projectId)}`)).project;
}

export async function createProject(input: { name: string; description?: string; tags?: string[]; color?: string; rootPath?: string | null }): Promise<ProjectDetail> {
  return (await requestJson<{ project: ProjectDetail }>('/api/projects', json('POST', input))).project;
}

export async function updateProject(projectId: string, patch: { name?: string; description?: string; tags?: string[]; color?: string; rootPath?: string | null }): Promise<ProjectDetail> {
  return (await requestJson<{ project: ProjectDetail }>(`/api/projects/${encodeURIComponent(projectId)}`, json('PATCH', patch))).project;
}

export async function deleteProject(projectId: string): Promise<{ activeDiagramId: string | null; activeProjectId: string | null }> {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, json('DELETE'));
}

export async function getProjectContext(projectId: string): Promise<string> {
  return (await requestJson<{ markdown: string }>(`/api/projects/${encodeURIComponent(projectId)}/context`)).markdown;
}

export async function resolveProject(ref?: string): Promise<ProjectSummary> {
  const projects = await listProjects();
  if (!ref) {
    const { activeProjectId } = await getWorkspace();
    const active = projects.find(p => p.id === activeProjectId);
    if (active) return active;
    if (projects.length === 1) return projects[0]!;
    throw new Error('No active project. Pass a project id, slug or name.');
  }
  const needle = ref.trim().toLowerCase();
  const match = projects.find(p => p.id === ref)
    ?? projects.find(p => p.slug === needle)
    ?? projects.find(p => p.name.toLowerCase() === needle);
  if (!match) {
    throw new Error(`Project "${ref}" not found. Known projects: ${projects.map(p => `${p.name} (${p.slug})`).join(', ') || 'none'}`);
  }
  return match;
}

// ---- diagrams -------------------------------------------------------------

export async function listDiagrams(projectId: string): Promise<DiagramMeta[]> {
  return (await requestJson<{ diagrams: DiagramMeta[] }>(`/api/projects/${encodeURIComponent(projectId)}/diagrams`)).diagrams;
}

export async function getDiagram(diagramId: string, withScene = false): Promise<{ diagram: DiagramMeta; active: boolean; scene?: DiagramScene }> {
  return requestJson(`/api/diagrams/${encodeURIComponent(diagramId)}${withScene ? '?scene=1' : ''}`);
}

export async function createDiagram(projectId: string, input: { name: string; description?: string; tags?: string[]; open?: boolean; scene?: DiagramScene }): Promise<{ diagram: DiagramMeta; active: boolean }> {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/diagrams`, json('POST', input));
}

export async function updateDiagram(diagramId: string, patch: { name?: string; description?: string; tags?: string[] }): Promise<DiagramMeta> {
  return (await requestJson<{ diagram: DiagramMeta }>(`/api/diagrams/${encodeURIComponent(diagramId)}`, json('PATCH', patch))).diagram;
}

export async function deleteDiagram(diagramId: string): Promise<{ deleted: DiagramMeta; activeDiagramId: string | null }> {
  return requestJson(`/api/diagrams/${encodeURIComponent(diagramId)}`, json('DELETE'));
}

export async function openDiagram(diagramId: string): Promise<DiagramMeta> {
  return (await requestJson<{ diagram: DiagramMeta }>(`/api/diagrams/${encodeURIComponent(diagramId)}/open`, json('POST'))).diagram;
}

export async function resolveDiagram(ref?: string, projectRef?: string): Promise<DiagramMeta> {
  const workspace = await getWorkspace();
  if (!ref) {
    if (workspace.activeDiagram) return workspace.activeDiagram;
    throw new Error('No diagram is active. Pass a diagram id or name, or open one first.');
  }
  if (!projectRef) {
    // Direct id lookup works across projects.
    try {
      return (await getDiagram(ref)).diagram;
    } catch { /* fall through to name resolution */ }
  }
  const scope = projectRef
    ? [await resolveProject(projectRef)]
    : workspace.activeProjectId
      ? [await resolveProject(workspace.activeProjectId), ...(await listProjects()).filter(p => p.id !== workspace.activeProjectId)]
      : await listProjects();
  const needle = ref.trim().toLowerCase();
  for (const project of scope) {
    const diagrams = await listDiagrams(project.id);
    const match = diagrams.find(d => d.id === ref) ?? diagrams.find(d => d.name.toLowerCase() === needle);
    if (match) return match;
  }
  throw new Error(`Diagram "${ref}" not found${projectRef ? ` in project "${projectRef}"` : ''}.`);
}

// ---- versions -------------------------------------------------------------

export async function listVersions(diagramId: string): Promise<VersionMeta[]> {
  return (await requestJson<{ versions: VersionMeta[] }>(`/api/diagrams/${encodeURIComponent(diagramId)}/versions`)).versions;
}

export async function saveVersion(diagramId: string, input: { label?: string; note?: string; author?: string; confirm?: boolean }): Promise<VersionMeta> {
  return (await requestJson<{ version: VersionMeta }>(`/api/diagrams/${encodeURIComponent(diagramId)}/versions`, json('POST', input))).version;
}

export async function getVersion(versionId: string, withScene = true): Promise<Version | VersionMeta> {
  return (await requestJson<{ version: Version }>(`/api/versions/${encodeURIComponent(versionId)}${withScene ? '' : '?scene=0'}`)).version;
}

export async function updateVersion(versionId: string, patch: { confirmed?: boolean; label?: string; note?: string }): Promise<VersionMeta> {
  return (await requestJson<{ version: VersionMeta }>(`/api/versions/${encodeURIComponent(versionId)}`, json('PATCH', patch))).version;
}

export async function restoreVersion(versionId: string, saveCurrentAs?: string): Promise<{ version: VersionMeta; diagram: DiagramMeta }> {
  return requestJson(`/api/versions/${encodeURIComponent(versionId)}/restore`, json('POST', saveCurrentAs ? { saveCurrentAs } : {}));
}

export async function deleteVersion(versionId: string): Promise<VersionMeta> {
  return (await requestJson<{ deleted: VersionMeta }>(`/api/versions/${encodeURIComponent(versionId)}`, json('DELETE'))).deleted;
}

// A version ref is an id (v_...), a number, or "v<number>".
export async function resolveVersion(ref: string | number, diagramId: string): Promise<VersionMeta> {
  const versions = await listVersions(diagramId);
  const asString = String(ref).trim();
  const number = Number(asString.replace(/^v/i, ''));
  const match = versions.find(v => v.id === asString) ?? (Number.isInteger(number) ? versions.find(v => v.number === number) : undefined);
  if (!match) {
    throw new Error(`Version "${ref}" not found. Available: ${versions.map(v => `v${v.number} (${v.label})`).join(', ') || 'none'}`);
  }
  return match;
}

// ---- notes ----------------------------------------------------------------

export async function listNotes(projectId: string, filter: { diagramId?: string | null; elementId?: string } = {}): Promise<Note[]> {
  const params = new URLSearchParams();
  if (filter.diagramId !== undefined) params.set('diagramId', filter.diagramId ?? 'null');
  if (filter.elementId) params.set('elementId', filter.elementId);
  const query = params.toString();
  return (await requestJson<{ notes: Note[] }>(`/api/projects/${encodeURIComponent(projectId)}/notes${query ? `?${query}` : ''}`)).notes;
}

export async function addNote(projectId: string, input: { diagramId?: string | null; body: string; author?: string; role?: 'human' | 'agent'; elementIds?: string[]; tags?: string[] }): Promise<Note> {
  return (await requestJson<{ note: Note }>(`/api/projects/${encodeURIComponent(projectId)}/notes`, json('POST', input))).note;
}

export async function updateNote(noteId: string, patch: { body?: string; resolved?: boolean; tags?: string[]; elementIds?: string[] }): Promise<Note> {
  return (await requestJson<{ note: Note }>(`/api/notes/${encodeURIComponent(noteId)}`, json('PATCH', patch))).note;
}

export async function deleteNote(noteId: string): Promise<Note> {
  return (await requestJson<{ deleted: Note }>(`/api/notes/${encodeURIComponent(noteId)}`, json('DELETE'))).deleted;
}

// ---- links ----------------------------------------------------------------

export async function listLinks(projectId: string, diagramId?: string): Promise<Link[]> {
  return (await requestJson<{ links: Link[] }>(`/api/projects/${encodeURIComponent(projectId)}/links${diagramId ? `?diagramId=${encodeURIComponent(diagramId)}` : ''}`)).links;
}

export async function createLink(projectId: string, input: { from: LinkEnd; to: LinkEnd; relation?: string; note?: string }): Promise<Link> {
  return (await requestJson<{ link: Link }>(`/api/projects/${encodeURIComponent(projectId)}/links`, json('POST', input))).link;
}

export async function deleteLink(linkId: string): Promise<Link> {
  return (await requestJson<{ deleted: Link }>(`/api/links/${encodeURIComponent(linkId)}`, json('DELETE'))).deleted;
}

// ---- element tags ---------------------------------------------------------

export async function tagElements(input: { elementIds: string[]; tags?: string[]; addTags?: string[]; removeTags?: string[]; note?: string | null; diagramId?: string }): Promise<ServerElement[]> {
  return (await requestJson<{ elements: ServerElement[] }>('/api/elements/tags', json('POST', input))).elements;
}

export async function findByTag(tag: string, diagramId?: string): Promise<Array<{ diagramId: string; diagramName: string; element: ServerElement }>> {
  return (await requestJson<{ results: Array<{ diagramId: string; diagramName: string; element: ServerElement }> }>(
    `/api/tags/${encodeURIComponent(tag)}${diagramId ? `?diagramId=${encodeURIComponent(diagramId)}` : ''}`
  )).results;
}

export function diagramUrl(projectId: string, diagramId: string): string {
  return `${EXPRESS_SERVER_URL}/p/${projectId}/d/${diagramId}`;
}
