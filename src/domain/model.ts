import type { ServerElement, ExcalidrawFile } from '../types.js';

// Domain model for the workspace layer.
//
// A Project is the aggregate root: one domain the user is thinking about
// ("how a water heater works", "order pipeline"). It owns Diagrams, Notes
// and Links. Diagrams own Versions. The live canvas is always one diagram's
// working copy; everything else lives on disk under the data directory.

export interface DiagramScene {
  elements: ServerElement[];
  files: Record<string, ExcalidrawFile>;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  color: string;
  // Local folder this project describes (usually a repo). Agents may read it.
  rootPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramMeta {
  id: string;
  projectId: string;
  name: string;
  description: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  elementCount: number;
  versionCount: number;
  latestVersion: number | null;
  latestConfirmedVersion: number | null;
}

export interface Diagram extends DiagramMeta {
  scene: DiagramScene;
}

export interface VersionMeta {
  id: string;
  diagramId: string;
  projectId: string;
  number: number;
  label: string;
  note: string;
  author: string;
  confirmed: boolean;
  confirmedAt: string | null;
  createdAt: string;
  elementCount: number;
}

export interface Version extends VersionMeta {
  scene: DiagramScene;
}

export type NoteRole = 'human' | 'agent';

export interface Note {
  id: string;
  projectId: string;
  diagramId: string | null;
  author: string;
  role: NoteRole;
  body: string;
  elementIds: string[];
  tags: string[];
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkEnd {
  diagramId: string;
  elementId?: string;
}

export interface Link {
  id: string;
  projectId: string;
  from: LinkEnd;
  to: LinkEnd;
  relation: string;
  note: string;
  createdAt: string;
}

export interface WorkspaceState {
  activeDiagramId: string | null;
}

export interface ProjectSummary extends Project {
  diagramCount: number;
  noteCount: number;
  linkCount: number;
}

export interface ProjectDetail extends ProjectSummary {
  diagrams: DiagramMeta[];
  links: Link[];
}

export const DEFAULT_PROJECT_COLORS = [
  '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#14b8a6', '#f97316'
];

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}

export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().replace(/^#/, '').toLowerCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}

export function emptyScene(): DiagramScene {
  return { elements: [], files: {} };
}
