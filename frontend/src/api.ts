// Typed client for the workspace REST API. Mirrors src/domain/model.ts.

export interface Project {
  id: string; name: string; slug: string; description: string; tags: string[]; color: string;
  rootPath: string | null;
  createdAt: string; updatedAt: string;
}
export interface FolderInfo {
  rootPath: string | null; display: string | null; exists: boolean;
  git: { isRepo: boolean; branch: string | null; remote: string | null } | null;
}
export interface ProjectSummary extends Project { diagramCount: number; noteCount: number; linkCount: number }
export interface DiagramMeta {
  id: string; projectId: string; name: string; description: string; tags: string[];
  createdAt: string; updatedAt: string; elementCount: number; versionCount: number;
  latestVersion: number | null; latestConfirmedVersion: number | null;
}
export interface ProjectDetail extends ProjectSummary { diagrams: DiagramMeta[]; links: Link[]; folder?: FolderInfo }
export interface VersionMeta {
  id: string; diagramId: string; projectId: string; number: number; label: string; note: string; author: string;
  confirmed: boolean; confirmedAt: string | null; createdAt: string; elementCount: number;
}
export interface Note {
  id: string; projectId: string; diagramId: string | null; author: string; role: 'human' | 'agent';
  body: string; elementIds: string[]; tags: string[]; resolved: boolean; createdAt: string; updatedAt: string;
}
export interface LinkEnd { diagramId: string; elementId?: string }
export interface Link { id: string; projectId: string; from: LinkEnd; to: LinkEnd; relation: string; note: string; createdAt: string }
export interface WorkspaceInfo { activeDiagramId: string | null; activeProjectId: string | null; activeDiagram: DiagramMeta | null; dataDir: string }

export type RunnerId = 'claude' | 'codex';
export interface RunnerOption { value: string; label: string }
export interface RunnerInfo { id: RunnerId; label: string; available: boolean; path: string | null; version: string | null; reason: string | null; models: RunnerOption[]; efforts: RunnerOption[] }
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; kind: 'mcp' | 'read' | 'command' | 'other'; detail: string; status: 'running' | 'done' | 'error'; error?: string };
export interface ChatActivity { phase: 'starting' | 'thinking' | 'writing' | 'tool' | 'replying'; label: string; since: string }
export interface ChatMessage {
  id: string; threadId: string; projectId: string; diagramId: string | null; role: 'user' | 'assistant'; runner: RunnerId | null;
  text: string; parts: ChatPart[]; selectedIds: string[]; status: 'running' | 'done' | 'error' | 'cancelled';
  error: string | null; createdAt: string; finishedAt: string | null; durationMs: number | null; costUsd: number | null;
  model: string | null; effort: string | null; thinking: string; liveText: string; activity: ChatActivity | null;
}
export interface ChatThreadSummary { id: string; title: string; createdAt: string; updatedAt: string; messageCount: number; runners: RunnerId[]; running: boolean }
export interface ChatThread { id: string; projectId: string; title: string; createdAt: string; updatedAt: string; sessions: Partial<Record<RunnerId, string>>; messages: ChatMessage[] }
export interface DirListing {
  path: string; parent: string | null; home: string; isGitRepo: boolean; truncated: boolean;
  entries: Array<{ name: string; path: string; isGitRepo: boolean }>;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || `${response.status} ${response.statusText}`, response.status);
  return data;
}

export const api = {
  workspace: () => request<WorkspaceInfo>('/api/workspace'),

  projects: () => request<{ projects: ProjectSummary[] }>('/api/projects').then(r => r.projects),
  project: (id: string) => request<{ project: ProjectDetail }>(`/api/projects/${id}`).then(r => r.project),
  createProject: (input: { name: string; description?: string; tags?: string[]; color?: string; rootPath?: string | null }) =>
    request<{ project: ProjectDetail }>('/api/projects', { method: 'POST', json: input }).then(r => r.project),
  updateProject: (id: string, patch: Partial<{ name: string; description: string; tags: string[]; color: string; rootPath: string | null }>) =>
    request<{ project: ProjectDetail }>(`/api/projects/${id}`, { method: 'PATCH', json: patch }).then(r => r.project),
  deleteProject: (id: string) => request<{ activeDiagramId: string | null; activeProjectId: string | null }>(`/api/projects/${id}`, { method: 'DELETE' }),
  projectContext: (id: string) => request<{ markdown: string }>(`/api/projects/${id}/context`).then(r => r.markdown),

  diagrams: (projectId: string) => request<{ diagrams: DiagramMeta[] }>(`/api/projects/${projectId}/diagrams`).then(r => r.diagrams),
  diagram: (id: string) => request<{ diagram: DiagramMeta; active: boolean }>(`/api/diagrams/${id}`),
  createDiagram: (projectId: string, input: { name: string; description?: string; tags?: string[]; open?: boolean }) =>
    request<{ diagram: DiagramMeta; active: boolean }>(`/api/projects/${projectId}/diagrams`, { method: 'POST', json: input }),
  updateDiagram: (id: string, patch: Partial<{ name: string; description: string; tags: string[] }>) =>
    request<{ diagram: DiagramMeta }>(`/api/diagrams/${id}`, { method: 'PATCH', json: patch }).then(r => r.diagram),
  deleteDiagram: (id: string) => request<{ deleted: DiagramMeta; activeDiagramId: string | null }>(`/api/diagrams/${id}`, { method: 'DELETE' }),
  openDiagram: (id: string) => request<{ diagram: DiagramMeta }>(`/api/diagrams/${id}/open`, { method: 'POST' }).then(r => r.diagram),

  versions: (diagramId: string) => request<{ versions: VersionMeta[] }>(`/api/diagrams/${diagramId}/versions`).then(r => r.versions),
  saveVersion: (diagramId: string, input: { label?: string; note?: string; author?: string; confirm?: boolean }) =>
    request<{ version: VersionMeta }>(`/api/diagrams/${diagramId}/versions`, { method: 'POST', json: input }).then(r => r.version),
  updateVersion: (id: string, patch: { confirmed?: boolean; label?: string; note?: string }) =>
    request<{ version: VersionMeta }>(`/api/versions/${id}`, { method: 'PATCH', json: patch }).then(r => r.version),
  restoreVersion: (id: string, saveCurrentAs?: string) =>
    request<{ version: VersionMeta }>(`/api/versions/${id}/restore`, { method: 'POST', json: saveCurrentAs ? { saveCurrentAs } : {} }),
  deleteVersion: (id: string) => request<{ deleted: VersionMeta }>(`/api/versions/${id}`, { method: 'DELETE' }),

  notes: (projectId: string, filter: { diagramId?: string | null; elementId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.diagramId !== undefined) params.set('diagramId', filter.diagramId ?? 'null');
    if (filter.elementId) params.set('elementId', filter.elementId);
    const query = params.toString();
    return request<{ notes: Note[] }>(`/api/projects/${projectId}/notes${query ? `?${query}` : ''}`).then(r => r.notes);
  },
  addNote: (projectId: string, input: { diagramId?: string | null; body: string; author?: string; role?: 'human' | 'agent'; elementIds?: string[]; tags?: string[] }) =>
    request<{ note: Note }>(`/api/projects/${projectId}/notes`, { method: 'POST', json: input }).then(r => r.note),
  updateNote: (id: string, patch: { body?: string; resolved?: boolean; tags?: string[]; elementIds?: string[] }) =>
    request<{ note: Note }>(`/api/notes/${id}`, { method: 'PATCH', json: patch }).then(r => r.note),
  deleteNote: (id: string) => request<{ deleted: Note }>(`/api/notes/${id}`, { method: 'DELETE' }),

  links: (projectId: string, diagramId?: string) =>
    request<{ links: Link[] }>(`/api/projects/${projectId}/links${diagramId ? `?diagramId=${diagramId}` : ''}`).then(r => r.links),
  createLink: (projectId: string, input: { from: LinkEnd; to: LinkEnd; relation?: string; note?: string }) =>
    request<{ link: Link }>(`/api/projects/${projectId}/links`, { method: 'POST', json: input }).then(r => r.link),
  deleteLink: (id: string) => request<{ deleted: Link }>(`/api/links/${id}`, { method: 'DELETE' }),

  tagElements: (input: { elementIds: string[]; tags?: string[]; addTags?: string[]; removeTags?: string[]; note?: string | null; diagramId?: string }) =>
    request<{ elements: Array<{ id: string; customData: Record<string, unknown> | null }> }>('/api/elements/tags', { method: 'POST', json: input }).then(r => r.elements),
  agents: (refresh = false) => request<{ enabled: boolean; runners: RunnerInfo[] }>(`/api/agents${refresh ? '?refresh=1' : ''}`),
  chats: (projectId: string) => request<{ threads: ChatThreadSummary[]; runningThreadId: string | null }>(`/api/projects/${projectId}/chats`),
  chatThread: (projectId: string, threadId: string) => request<{ thread: ChatThread; running: boolean }>(`/api/projects/${projectId}/chats/${threadId}`).then(r => r.thread),
  renameChat: (projectId: string, threadId: string, title: string) => request<{ thread: ChatThread }>(`/api/projects/${projectId}/chats/${threadId}`, { method: 'PATCH', json: { title } }),
  deleteChat: (projectId: string, threadId: string) => request<{ success: boolean }>(`/api/projects/${projectId}/chats/${threadId}`, { method: 'DELETE' }),
  sendChat: (projectId: string, threadId: string | null, input: { message: string; runner: RunnerId; diagramId?: string | null; selectedIds?: string[]; model?: string | null; effort?: string | null }) =>
    request<{ threadId: string; user: ChatMessage; assistant: ChatMessage }>(`/api/projects/${projectId}/chats/${threadId ?? 'new'}/messages`, { method: 'POST', json: input }),
  cancelChat: (projectId: string) => request<{ cancelled: boolean }>(`/api/projects/${projectId}/chat/cancel`, { method: 'POST', json: {} }),
  runLog: async (projectId: string, threadId: string, messageId: string): Promise<string> => {
    const response = await fetch(`/api/projects/${projectId}/chats/${threadId}/messages/${messageId}/log`);
    if (!response.ok) throw new ApiError(response.status === 404 ? 'No log for this run yet' : `${response.status}`, response.status);
    return response.text();
  },
  dirs: (path?: string) => request<DirListing>(`/api/fs/dirs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  reveal: (projectId: string) => request<{ success: boolean }>(`/api/projects/${projectId}/reveal`, { method: 'POST', json: {} }),

  updateElement: (id: string, patch: Record<string, unknown>) =>
    request<{ element: Record<string, unknown> }>(`/api/elements/${id}`, { method: 'PUT', json: patch }).then(r => r.element)
};

export function diagramPath(projectId: string, diagramId: string): string {
  return `/p/${projectId}/d/${diagramId}`;
}

export function projectPath(projectId: string): string {
  return `/p/${projectId}`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function fmtTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function fmtWhen(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return timeFmt.format(date).slice(0, 5);
  if (diff < 7 * 86_400_000) return dateTimeFmt.format(date);
  return dateFmt.format(date);
}

export function parseTags(raw: string): string[] {
  return raw.split(',').map(t => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
}
