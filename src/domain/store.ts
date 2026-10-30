import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { newId } from './ids.js';
import {
  type Diagram,
  type DiagramMeta,
  type DiagramScene,
  type Link,
  type LinkEnd,
  type Note,
  type NoteRole,
  type Project,
  type ProjectDetail,
  type ProjectSummary,
  type Version,
  type VersionMeta,
  type WorkspaceState,
  DEFAULT_PROJECT_COLORS,
  emptyScene,
  normalizeTags,
  slugify
} from './model.js';

import { LocalDatabase } from './database.js';
import { importLegacyJson } from './import-json.js';

import { NotFoundError, ValidationError } from './errors.js';
import { normalizeRootPath } from './folder.js';

export { NotFoundError, ValidationError };

function nowIso(): string {
  return new Date().toISOString();
}

function requireName(value: unknown, what: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new ValidationError(`${what} name is required`);
  if (name.length > 120) throw new ValidationError(`${what} name must be 120 characters or fewer`);
  return name;
}

function optionalText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export interface ProjectInput {
  name: string;
  description?: string;
  tags?: string[];
  color?: string;
  rootPath?: string | null;
}

export interface DiagramInput {
  name: string;
  description?: string;
  tags?: string[];
  scene?: DiagramScene;
}

export interface VersionInput {
  label?: string;
  note?: string;
  author?: string;
  confirm?: boolean;
}

export interface NoteInput {
  diagramId?: string | null;
  body: string;
  author?: string;
  role?: NoteRole;
  elementIds?: string[];
  tags?: string[];
}

export interface LinkInput {
  from: LinkEnd;
  to: LinkEnd;
  relation?: string;
  note?: string;
}

export class WorkspaceStore {
  readonly dataDir: string;
  readonly db: LocalDatabase;

  constructor(dataDir: string, readonly legacyDataDir = dataDir) {
    this.dataDir = dataDir;
    this.db = new LocalDatabase(dataDir);
  }

  projectDir(projectId: string): string {
    return path.join(this.dataDir, 'projects', projectId);
  }

  load(): void {
    importLegacyJson(this.db, this.legacyDataDir);
    for (const project of this.db.records<Project>('projects')) {
      fs.mkdirSync(this.projectDir(project.id), { recursive: true });
    }
    logger.info('Workspace loaded', { database: this.db.filename });
  }

  close(): void {
    this.db.close();
  }

  // ---- workspace state ---------------------------------------------------

  getState(): WorkspaceState {
    return { activeDiagramId: this.db.get<{ active_diagram_id: string | null }>('SELECT active_diagram_id FROM workspace WHERE id = 1')!.active_diagram_id };
  }

  setActiveDiagram(diagramId: string | null): void {
    if (diagramId !== null) this.requireDiagram(diagramId);
    this.db.run('UPDATE workspace SET active_diagram_id = ? WHERE id = 1', diagramId);
  }

  // ---- projects -----------------------------------------------------------

  listProjects(): ProjectSummary[] {
    return this.db.records<Project>('projects')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(project => this.summarize(project));
  }

  private summarize(project: Project): ProjectSummary {
    const count = (table: 'diagrams' | 'notes' | 'links'): number => this.db.get<{ count: number }>(
      `SELECT count(*) AS count FROM ${table} WHERE project_id = ?`, project.id
    )!.count;
    const diagramCount = count('diagrams');
    const noteCount = count('notes');
    const linkCount = count('links');
    return { ...project, diagramCount, noteCount, linkCount };
  }

  getProject(projectId: string): ProjectDetail {
    const project = this.requireProject(projectId);
    return {
      ...this.summarize(project),
      diagrams: this.listDiagrams(projectId),
      links: this.listLinks(projectId)
    };
  }

  findProject(ref: string): Project | null {
    const [byId] = this.db.records<Project>('projects', 'WHERE id = ?', ref);
    if (byId) return byId;
    const needle = ref.trim().toLowerCase();
    for (const project of this.db.records<Project>('projects')) {
      if (project.slug === needle || project.name.toLowerCase() === needle) return project;
    }
    return null;
  }

  createProject(input: ProjectInput): Project {
    const name = requireName(input.name, 'Project');
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let n = 2;
    while (this.db.records<Project>('projects').some(p => p.slug === slug)) slug = `${baseSlug}-${n++}`;
    const createdAt = nowIso();
    const project: Project = {
      id: newId('p'),
      name,
      slug,
      description: optionalText(input.description),
      tags: normalizeTags(input.tags),
      color: typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color)
        ? input.color
        : DEFAULT_PROJECT_COLORS[this.db.records<Project>('projects').length % DEFAULT_PROJECT_COLORS.length]!,
      rootPath: normalizeRootPath(input.rootPath),
      createdAt,
      updatedAt: createdAt
    };
    this.writeProject(project);
    fs.mkdirSync(this.projectDir(project.id), { recursive: true });
    return project;
  }

  updateProject(projectId: string, patch: Partial<ProjectInput>): Project {
    const project = this.requireProject(projectId);
    if (patch.name !== undefined) project.name = requireName(patch.name, 'Project');
    if (patch.description !== undefined) project.description = optionalText(patch.description);
    if (patch.tags !== undefined) project.tags = normalizeTags(patch.tags);
    if (patch.color !== undefined && /^#[0-9a-f]{6}$/i.test(patch.color)) project.color = patch.color;
    if (patch.rootPath !== undefined) project.rootPath = normalizeRootPath(patch.rootPath);
    project.updatedAt = nowIso();
    this.writeProject(project);
    return project;
  }

  deleteProject(projectId: string): { diagramIds: string[] } {
    const project = this.requireProject(projectId);
    const diagramIds = this.listDiagrams(projectId).map(d => d.id);
    this.db.run('DELETE FROM projects WHERE id = ?', project.id);
    return { diagramIds };
  }

  private touchProject(projectId: string): void {
    const [project] = this.db.records<Project>('projects', 'WHERE id = ?', projectId);
    if (!project) return;
    project.updatedAt = nowIso();
    this.writeProject(project);
  }

  private writeProject(project: Project): void {
    this.db.put('projects', project);
  }

  private requireProject(projectId: string): Project {
    const [project] = this.db.records<Project>('projects', 'WHERE id = ?', projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    return project;
  }

  // ---- diagrams -----------------------------------------------------------

  listDiagrams(projectId: string): DiagramMeta[] {
    this.requireProject(projectId);
    return this.db.records<Diagram>('diagrams', 'WHERE project_id = ?', projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(d => this.diagramMeta(d));
  }

  listAllDiagrams(): DiagramMeta[] {
    return this.db.records<Diagram>('diagrams').map(d => this.diagramMeta(d));
  }

  diagramMeta(diagram: Diagram): DiagramMeta {
    const { scene: _scene, ...meta } = diagram;
    return { ...meta, ...this.versionStats(diagram.id), elementCount: diagram.scene.elements.length };
  }

  getDiagram(diagramId: string): Diagram {
    return this.requireDiagram(diagramId);
  }

  findDiagram(projectId: string | null, ref: string): Diagram | null {
    const [byId] = this.db.records<Diagram>('diagrams', 'WHERE id = ?', ref);
    if (byId && (projectId === null || byId.projectId === projectId)) return this.requireDiagram(byId.id);
    const needle = ref.trim().toLowerCase();
    for (const diagram of this.db.records<Diagram>('diagrams')) {
      if (projectId !== null && diagram.projectId !== projectId) continue;
      if (diagram.name.toLowerCase() === needle) return this.requireDiagram(diagram.id);
    }
    return null;
  }

  createDiagram(projectId: string, input: DiagramInput): Diagram {
    this.requireProject(projectId);
    const createdAt = nowIso();
    const diagram: Diagram = {
      id: newId('d'),
      projectId,
      name: requireName(input.name, 'Diagram'),
      description: optionalText(input.description),
      tags: normalizeTags(input.tags),
      createdAt,
      updatedAt: createdAt,
      elementCount: input.scene?.elements.length ?? 0,
      versionCount: 0,
      latestVersion: null,
      latestConfirmedVersion: null,
      scene: input.scene ? structuredClone(input.scene) : emptyScene()
    };
    this.db.transaction(() => {
      this.writeDiagram(diagram);
      this.touchProject(projectId);
    });
    return diagram;
  }

  updateDiagram(diagramId: string, patch: Partial<Omit<DiagramInput, 'scene'>>): Diagram {
    const diagram = this.requireDiagram(diagramId);
    if (patch.name !== undefined) diagram.name = requireName(patch.name, 'Diagram');
    if (patch.description !== undefined) diagram.description = optionalText(patch.description);
    if (patch.tags !== undefined) diagram.tags = normalizeTags(patch.tags);
    diagram.updatedAt = nowIso();
    this.db.transaction(() => {
      this.writeDiagram(diagram);
      this.touchProject(diagram.projectId);
    });
    return diagram;
  }

  // Persist the working copy. Called by the autosave after live edits and
  // before the active diagram changes.
  saveDiagramScene(diagramId: string, scene: DiagramScene): Diagram {
    const diagram = this.requireDiagram(diagramId);
    diagram.scene = structuredClone(scene);
    diagram.elementCount = scene.elements.length;
    diagram.updatedAt = nowIso();
    this.writeDiagram(diagram);
    return diagram;
  }

  deleteDiagram(diagramId: string): Diagram {
    const diagram = this.requireDiagram(diagramId);
    this.db.transaction(() => {
      this.db.run('DELETE FROM diagrams WHERE id = ?', diagramId);
      this.touchProject(diagram.projectId);
    });
    return diagram;
  }

  private writeDiagram(diagram: Diagram): void {
    this.db.put('diagrams', diagram);
  }

  private requireDiagram(diagramId: string): Diagram {
    const [diagram] = this.db.records<Diagram>('diagrams', 'WHERE id = ?', diagramId);
    if (!diagram) throw new NotFoundError(`Diagram ${diagramId} not found`);
    return { ...diagram, ...this.versionStats(diagramId), elementCount: diagram.scene.elements.length };
  }

  private versionStats(diagramId: string): Pick<DiagramMeta, 'versionCount' | 'latestVersion' | 'latestConfirmedVersion'> {
    const stats = this.db.get<{ versionCount: number; latestVersion: number | null; latestConfirmedVersion: number | null }>(
      `SELECT count(*) AS versionCount, max(number) AS latestVersion,
       max(CASE WHEN json_extract(data, '$.confirmed') = 1 THEN number END) AS latestConfirmedVersion
       FROM versions WHERE diagram_id = ?`, diagramId
    )!;
    return stats;
  }

  // ---- versions -----------------------------------------------------------

  listVersions(diagramId: string): VersionMeta[] {
    this.requireDiagram(diagramId);
    return this.db.records<Version>('versions', 'WHERE diagram_id = ?', diagramId)
      .sort((a, b) => b.number - a.number)
      .map(({ scene: _scene, ...meta }) => meta);
  }

  getVersion(versionId: string): Version {
    const [version] = this.db.records<Version>('versions', 'WHERE id = ?', versionId);
    if (!version) throw new NotFoundError(`Version ${versionId} not found`);
    return version;
  }

  findVersion(diagramId: string, ref: string | number): VersionMeta | null {
    const byId = typeof ref === 'string' ? this.db.records<Version>('versions', 'WHERE id = ?', ref)[0] : undefined;
    if (byId && byId.diagramId === diagramId) {
      const { scene: _scene, ...meta } = byId;
      return meta;
    }
    const number = typeof ref === 'number' ? ref : Number(String(ref).replace(/^v/i, ''));
    if (!Number.isInteger(number)) return null;
    return this.listVersions(diagramId).find(v => v.number === number) ?? null;
  }

  createVersion(diagramId: string, scene: DiagramScene, input: VersionInput): VersionMeta {
    return this.db.transaction(() => {
      const diagram = this.requireDiagram(diagramId);
      const number = (diagram.latestVersion ?? 0) + 1;
      const createdAt = nowIso();
      const confirm = input.confirm === true;
      const version: Version = {
        id: newId('v'),
        diagramId,
        projectId: diagram.projectId,
        number,
        label: optionalText(input.label).trim() || `v${number}`,
        note: optionalText(input.note),
        author: optionalText(input.author).trim() || 'human',
        confirmed: confirm,
        confirmedAt: confirm ? createdAt : null,
        createdAt,
        elementCount: scene.elements.length,
        scene: structuredClone(scene)
      };
      this.db.put('versions', version);
      const { scene: _scene, ...meta } = version;
      diagram.updatedAt = createdAt;
      this.writeDiagram(diagram);
      this.touchProject(diagram.projectId);
      return meta;
    });
  }

  updateVersion(versionId: string, patch: { confirmed?: boolean; label?: string; note?: string }): VersionMeta {
    const full = this.getVersion(versionId);
    if (patch.confirmed !== undefined) {
      full.confirmed = patch.confirmed;
      full.confirmedAt = patch.confirmed ? nowIso() : null;
    }
    if (patch.label !== undefined) full.label = optionalText(patch.label).trim() || full.label;
    if (patch.note !== undefined) full.note = optionalText(patch.note);
    this.db.put('versions', full);
    const { scene: _scene, ...updated } = full;
    return updated;
  }

  deleteVersion(versionId: string): VersionMeta {
    const { scene: _scene, ...meta } = this.getVersion(versionId);
    this.db.run('DELETE FROM versions WHERE id = ?', versionId);
    return meta;
  }

  // ---- notes --------------------------------------------------------------

  listNotes(projectId: string, filter: { diagramId?: string | null; elementId?: string } = {}): Note[] {
    this.requireProject(projectId);
    return this.db.records<Note>('notes', 'WHERE project_id = ?', projectId)
      .filter(n => filter.diagramId === undefined || n.diagramId === filter.diagramId)
      .filter(n => filter.elementId === undefined || n.elementIds.includes(filter.elementId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getNote(noteId: string): Note {
    const [note] = this.db.records<Note>('notes', 'WHERE id = ?', noteId);
    if (!note) throw new NotFoundError(`Note ${noteId} not found`);
    return note;
  }

  createNote(projectId: string, input: NoteInput): Note {
    this.requireProject(projectId);
    const body = optionalText(input.body).trim();
    if (!body) throw new ValidationError('Note body is required');
    if (input.diagramId) {
      const diagram = this.requireDiagram(input.diagramId);
      if (diagram.projectId !== projectId) throw new ValidationError('Diagram belongs to another project');
    }
    const createdAt = nowIso();
    const role: NoteRole = input.role === 'agent' ? 'agent' : 'human';
    const note: Note = {
      id: newId('n'),
      projectId,
      diagramId: input.diagramId ?? null,
      author: optionalText(input.author).trim() || (role === 'agent' ? 'agent' : 'human'),
      role,
      body,
      elementIds: Array.isArray(input.elementIds) ? input.elementIds.filter((id): id is string => typeof id === 'string') : [],
      tags: normalizeTags(input.tags),
      resolved: false,
      createdAt,
      updatedAt: createdAt
    };
    this.db.transaction(() => {
      this.db.put('notes', note);
      this.touchProject(projectId);
    });
    return note;
  }

  updateNote(noteId: string, patch: { body?: string; resolved?: boolean; tags?: string[]; elementIds?: string[] }): Note {
    const note = this.getNote(noteId);
    if (patch.body !== undefined) {
      const body = optionalText(patch.body).trim();
      if (!body) throw new ValidationError('Note body is required');
      note.body = body;
    }
    if (patch.resolved !== undefined) note.resolved = patch.resolved;
    if (patch.tags !== undefined) note.tags = normalizeTags(patch.tags);
    if (patch.elementIds !== undefined) note.elementIds = patch.elementIds.filter(id => typeof id === 'string');
    note.updatedAt = nowIso();
    this.db.put('notes', note);
    return note;
  }

  deleteNote(noteId: string): Note {
    const note = this.getNote(noteId);
    this.db.run('DELETE FROM notes WHERE id = ?', noteId);
    return note;
  }

  // ---- links --------------------------------------------------------------

  listLinks(projectId: string, diagramId?: string): Link[] {
    this.requireProject(projectId);
    return this.db.records<Link>('links', 'WHERE project_id = ?', projectId)
      .filter(l => diagramId === undefined || l.from.diagramId === diagramId || l.to.diagramId === diagramId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getLink(linkId: string): Link {
    const [link] = this.db.records<Link>('links', 'WHERE id = ?', linkId);
    if (!link) throw new NotFoundError(`Link ${linkId} not found`);
    return link;
  }

  createLink(projectId: string, input: LinkInput): Link {
    this.requireProject(projectId);
    const from = this.normalizeLinkEnd(projectId, input.from, 'from');
    const to = this.normalizeLinkEnd(projectId, input.to, 'to');
    if (from.diagramId === to.diagramId && (from.elementId ?? null) === (to.elementId ?? null)) {
      throw new ValidationError('A link must connect two different places');
    }
    const link: Link = {
      id: newId('l'),
      projectId,
      from,
      to,
      relation: optionalText(input.relation).trim() || 'relates-to',
      note: optionalText(input.note),
      createdAt: nowIso()
    };
    this.db.transaction(() => {
      this.db.put('links', link);
      this.touchProject(projectId);
    });
    return link;
  }

  deleteLink(linkId: string): Link {
    const link = this.getLink(linkId);
    this.db.run('DELETE FROM links WHERE id = ?', linkId);
    return link;
  }

  private normalizeLinkEnd(projectId: string, end: LinkEnd | undefined, side: string): LinkEnd {
    if (!end || typeof end.diagramId !== 'string') throw new ValidationError(`Link "${side}" needs a diagramId`);
    const diagram = this.requireDiagram(end.diagramId);
    if (diagram.projectId !== projectId) throw new ValidationError(`Link "${side}" diagram belongs to another project`);
    const normalized: LinkEnd = { diagramId: diagram.id };
    if (typeof end.elementId === 'string' && end.elementId) normalized.elementId = end.elementId;
    return normalized;
  }

}
