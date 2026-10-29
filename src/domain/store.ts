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

// File-backed repository for the workspace. Everything is plain JSON under
// the data directory so a project can be committed to git, diffed, or
// backed up by copying a folder:
//
//   <dataDir>/workspace.json
//   <dataDir>/projects/<projectId>/project.json
//   <dataDir>/projects/<projectId>/notes.json
//   <dataDir>/projects/<projectId>/links.json
//   <dataDir>/projects/<projectId>/diagrams/<diagramId>/diagram.json
//   <dataDir>/projects/<projectId>/diagrams/<diagramId>/versions/<nnnn>-<versionId>.json
//
// Reads come from memory (the whole index is loaded at startup); writes go
// through atomically (tmp file + rename) so a crash never leaves a half
// written diagram behind.

import { NotFoundError, ValidationError } from './errors.js';
import { normalizeRootPath } from './folder.js';

export { NotFoundError, ValidationError };

function nowIso(): string {
  return new Date().toISOString();
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn(`Could not read ${file}: ${(error as Error).message}`);
    }
    return null;
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  } catch {
    return [];
  }
}

function listFiles(dir: string, ext: string): string[] {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort();
  } catch {
    return [];
  }
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
  private projects = new Map<string, Project>();
  private diagrams = new Map<string, Diagram>();
  private versions = new Map<string, VersionMeta>();
  private notes = new Map<string, Note>();
  private links = new Map<string, Link>();
  private state: WorkspaceState = { activeDiagramId: null };

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  // ---- paths ------------------------------------------------------------

  projectDir(projectId: string): string {
    return path.join(this.dataDir, 'projects', projectId);
  }

  private diagramDir(projectId: string, diagramId: string): string {
    return path.join(this.projectDir(projectId), 'diagrams', diagramId);
  }

  private versionFile(version: VersionMeta): string {
    const number = String(version.number).padStart(4, '0');
    return path.join(this.diagramDir(version.projectId, version.diagramId), 'versions', `${number}-${version.id}.json`);
  }

  private workspaceFile(): string {
    return path.join(this.dataDir, 'workspace.json');
  }

  // ---- loading ----------------------------------------------------------

  load(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.projects.clear();
    this.diagrams.clear();
    this.versions.clear();
    this.notes.clear();
    this.links.clear();

    for (const projectId of listDirs(path.join(this.dataDir, 'projects'))) {
      const project = readJson<Project>(path.join(this.projectDir(projectId), 'project.json'));
      if (!project || project.id !== projectId) continue;
      project.rootPath ??= null;
      this.projects.set(project.id, project);

      for (const note of readJson<Note[]>(path.join(this.projectDir(projectId), 'notes.json')) ?? []) {
        this.notes.set(note.id, note);
      }
      for (const link of readJson<Link[]>(path.join(this.projectDir(projectId), 'links.json')) ?? []) {
        this.links.set(link.id, link);
      }

      for (const diagramId of listDirs(path.join(this.projectDir(projectId), 'diagrams'))) {
        const diagram = readJson<Diagram>(path.join(this.diagramDir(projectId, diagramId), 'diagram.json'));
        if (!diagram || diagram.id !== diagramId) continue;
        diagram.scene ??= emptyScene();
        diagram.scene.elements ??= [];
        diagram.scene.files ??= {};
        this.diagrams.set(diagram.id, diagram);

        const versionsDir = path.join(this.diagramDir(projectId, diagramId), 'versions');
        for (const file of listFiles(versionsDir, '.json')) {
          const version = readJson<Version>(path.join(versionsDir, file));
          if (!version || version.diagramId !== diagramId) continue;
          const { scene: _scene, ...meta } = version;
          this.versions.set(version.id, meta);
        }
        this.refreshDiagramVersionStats(diagram);
      }
    }

    const state = readJson<WorkspaceState>(this.workspaceFile());
    this.state = {
      activeDiagramId: state?.activeDiagramId && this.diagrams.has(state.activeDiagramId) ? state.activeDiagramId : null
    };

    logger.info(`Workspace loaded from ${this.dataDir}`, {
      projects: this.projects.size,
      diagrams: this.diagrams.size,
      versions: this.versions.size
    });
  }

  // ---- workspace state ---------------------------------------------------

  getState(): WorkspaceState {
    return { ...this.state };
  }

  setActiveDiagram(diagramId: string | null): void {
    if (diagramId !== null) this.requireDiagram(diagramId);
    this.state = { activeDiagramId: diagramId };
    writeJsonAtomic(this.workspaceFile(), this.state);
  }

  // ---- projects -----------------------------------------------------------

  listProjects(): ProjectSummary[] {
    return [...this.projects.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(project => this.summarize(project));
  }

  private summarize(project: Project): ProjectSummary {
    let diagramCount = 0;
    for (const diagram of this.diagrams.values()) if (diagram.projectId === project.id) diagramCount++;
    let noteCount = 0;
    for (const note of this.notes.values()) if (note.projectId === project.id) noteCount++;
    let linkCount = 0;
    for (const link of this.links.values()) if (link.projectId === project.id) linkCount++;
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
    const byId = this.projects.get(ref);
    if (byId) return byId;
    const needle = ref.trim().toLowerCase();
    for (const project of this.projects.values()) {
      if (project.slug === needle || project.name.toLowerCase() === needle) return project;
    }
    return null;
  }

  createProject(input: ProjectInput): Project {
    const name = requireName(input.name, 'Project');
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let n = 2;
    while ([...this.projects.values()].some(p => p.slug === slug)) slug = `${baseSlug}-${n++}`;
    const createdAt = nowIso();
    const project: Project = {
      id: newId('p'),
      name,
      slug,
      description: optionalText(input.description),
      tags: normalizeTags(input.tags),
      color: typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color)
        ? input.color
        : DEFAULT_PROJECT_COLORS[this.projects.size % DEFAULT_PROJECT_COLORS.length]!,
      rootPath: normalizeRootPath(input.rootPath),
      createdAt,
      updatedAt: createdAt
    };
    this.projects.set(project.id, project);
    this.writeProject(project);
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
    for (const id of diagramIds) this.diagrams.delete(id);
    for (const [id, v] of this.versions) if (v.projectId === projectId) this.versions.delete(id);
    for (const [id, n] of this.notes) if (n.projectId === projectId) this.notes.delete(id);
    for (const [id, l] of this.links) if (l.projectId === projectId) this.links.delete(id);
    this.projects.delete(projectId);
    fs.rmSync(this.projectDir(project.id), { recursive: true, force: true });
    if (diagramIds.includes(this.state.activeDiagramId ?? '')) this.setActiveDiagram(null);
    return { diagramIds };
  }

  private touchProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;
    project.updatedAt = nowIso();
    this.writeProject(project);
  }

  private writeProject(project: Project): void {
    writeJsonAtomic(path.join(this.projectDir(project.id), 'project.json'), project);
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.get(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    return project;
  }

  // ---- diagrams -----------------------------------------------------------

  listDiagrams(projectId: string): DiagramMeta[] {
    this.requireProject(projectId);
    return [...this.diagrams.values()]
      .filter(d => d.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(d => this.diagramMeta(d));
  }

  listAllDiagrams(): DiagramMeta[] {
    return [...this.diagrams.values()].map(d => this.diagramMeta(d));
  }

  diagramMeta(diagram: Diagram): DiagramMeta {
    const { scene: _scene, ...meta } = diagram;
    return { ...meta, elementCount: diagram.scene.elements.length };
  }

  getDiagram(diagramId: string): Diagram {
    return this.requireDiagram(diagramId);
  }

  findDiagram(projectId: string | null, ref: string): Diagram | null {
    const byId = this.diagrams.get(ref);
    if (byId && (projectId === null || byId.projectId === projectId)) return byId;
    const needle = ref.trim().toLowerCase();
    for (const diagram of this.diagrams.values()) {
      if (projectId !== null && diagram.projectId !== projectId) continue;
      if (diagram.name.toLowerCase() === needle) return diagram;
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
    this.diagrams.set(diagram.id, diagram);
    this.writeDiagram(diagram);
    this.touchProject(projectId);
    return diagram;
  }

  updateDiagram(diagramId: string, patch: Partial<Omit<DiagramInput, 'scene'>>): Diagram {
    const diagram = this.requireDiagram(diagramId);
    if (patch.name !== undefined) diagram.name = requireName(patch.name, 'Diagram');
    if (patch.description !== undefined) diagram.description = optionalText(patch.description);
    if (patch.tags !== undefined) diagram.tags = normalizeTags(patch.tags);
    diagram.updatedAt = nowIso();
    this.writeDiagram(diagram);
    this.touchProject(diagram.projectId);
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
    this.diagrams.delete(diagramId);
    for (const [id, v] of this.versions) if (v.diagramId === diagramId) this.versions.delete(id);
    for (const [id, n] of this.notes) if (n.diagramId === diagramId) this.notes.delete(id);
    let linksChanged = false;
    for (const [id, l] of this.links) {
      if (l.from.diagramId === diagramId || l.to.diagramId === diagramId) {
        this.links.delete(id);
        linksChanged = true;
      }
    }
    fs.rmSync(this.diagramDir(diagram.projectId, diagramId), { recursive: true, force: true });
    this.writeNotes(diagram.projectId);
    if (linksChanged) this.writeLinks(diagram.projectId);
    if (this.state.activeDiagramId === diagramId) this.setActiveDiagram(null);
    this.touchProject(diagram.projectId);
    return diagram;
  }

  private writeDiagram(diagram: Diagram): void {
    writeJsonAtomic(path.join(this.diagramDir(diagram.projectId, diagram.id), 'diagram.json'), diagram);
  }

  private requireDiagram(diagramId: string): Diagram {
    const diagram = this.diagrams.get(diagramId);
    if (!diagram) throw new NotFoundError(`Diagram ${diagramId} not found`);
    return diagram;
  }

  private refreshDiagramVersionStats(diagram: Diagram): void {
    const versions = [...this.versions.values()].filter(v => v.diagramId === diagram.id);
    diagram.versionCount = versions.length;
    diagram.latestVersion = versions.reduce<number | null>((max, v) => (max === null || v.number > max ? v.number : max), null);
    diagram.latestConfirmedVersion = versions
      .filter(v => v.confirmed)
      .reduce<number | null>((max, v) => (max === null || v.number > max ? v.number : max), null);
  }

  // ---- versions -----------------------------------------------------------

  listVersions(diagramId: string): VersionMeta[] {
    this.requireDiagram(diagramId);
    return [...this.versions.values()]
      .filter(v => v.diagramId === diagramId)
      .sort((a, b) => b.number - a.number);
  }

  getVersion(versionId: string): Version {
    const meta = this.versions.get(versionId);
    if (!meta) throw new NotFoundError(`Version ${versionId} not found`);
    const full = readJson<Version>(this.versionFile(meta));
    if (!full) throw new NotFoundError(`Version ${versionId} file is missing`);
    return { ...full, ...meta, scene: full.scene ?? emptyScene() };
  }

  findVersion(diagramId: string, ref: string | number): VersionMeta | null {
    const byId = typeof ref === 'string' ? this.versions.get(ref) : undefined;
    if (byId && byId.diagramId === diagramId) return byId;
    const number = typeof ref === 'number' ? ref : Number(String(ref).replace(/^v/i, ''));
    if (!Number.isInteger(number)) return null;
    return this.listVersions(diagramId).find(v => v.number === number) ?? null;
  }

  createVersion(diagramId: string, scene: DiagramScene, input: VersionInput): VersionMeta {
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
    writeJsonAtomic(this.versionFile(version), version);
    const { scene: _scene, ...meta } = version;
    this.versions.set(version.id, meta);
    this.refreshDiagramVersionStats(diagram);
    diagram.updatedAt = createdAt;
    this.writeDiagram(diagram);
    this.touchProject(diagram.projectId);
    return meta;
  }

  updateVersion(versionId: string, patch: { confirmed?: boolean; label?: string; note?: string }): VersionMeta {
    const meta = this.versions.get(versionId);
    if (!meta) throw new NotFoundError(`Version ${versionId} not found`);
    const full = this.getVersion(versionId);
    if (patch.confirmed !== undefined) {
      full.confirmed = patch.confirmed;
      full.confirmedAt = patch.confirmed ? nowIso() : null;
    }
    if (patch.label !== undefined) full.label = optionalText(patch.label).trim() || full.label;
    if (patch.note !== undefined) full.note = optionalText(patch.note);
    writeJsonAtomic(this.versionFile(meta), full);
    const { scene: _scene, ...updated } = full;
    this.versions.set(versionId, updated);
    const diagram = this.diagrams.get(meta.diagramId);
    if (diagram) {
      this.refreshDiagramVersionStats(diagram);
      this.writeDiagram(diagram);
    }
    return updated;
  }

  deleteVersion(versionId: string): VersionMeta {
    const meta = this.versions.get(versionId);
    if (!meta) throw new NotFoundError(`Version ${versionId} not found`);
    fs.rmSync(this.versionFile(meta), { force: true });
    this.versions.delete(versionId);
    const diagram = this.diagrams.get(meta.diagramId);
    if (diagram) {
      this.refreshDiagramVersionStats(diagram);
      this.writeDiagram(diagram);
    }
    return meta;
  }

  // ---- notes --------------------------------------------------------------

  listNotes(projectId: string, filter: { diagramId?: string | null; elementId?: string } = {}): Note[] {
    this.requireProject(projectId);
    return [...this.notes.values()]
      .filter(n => n.projectId === projectId)
      .filter(n => filter.diagramId === undefined || n.diagramId === filter.diagramId)
      .filter(n => filter.elementId === undefined || n.elementIds.includes(filter.elementId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getNote(noteId: string): Note {
    const note = this.notes.get(noteId);
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
    this.notes.set(note.id, note);
    this.writeNotes(projectId);
    this.touchProject(projectId);
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
    this.writeNotes(note.projectId);
    return note;
  }

  deleteNote(noteId: string): Note {
    const note = this.getNote(noteId);
    this.notes.delete(noteId);
    this.writeNotes(note.projectId);
    return note;
  }

  private writeNotes(projectId: string): void {
    if (!this.projects.has(projectId)) return;
    const notes = [...this.notes.values()].filter(n => n.projectId === projectId);
    writeJsonAtomic(path.join(this.projectDir(projectId), 'notes.json'), notes);
  }

  // ---- links --------------------------------------------------------------

  listLinks(projectId: string, diagramId?: string): Link[] {
    this.requireProject(projectId);
    return [...this.links.values()]
      .filter(l => l.projectId === projectId)
      .filter(l => diagramId === undefined || l.from.diagramId === diagramId || l.to.diagramId === diagramId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getLink(linkId: string): Link {
    const link = this.links.get(linkId);
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
    this.links.set(link.id, link);
    this.writeLinks(projectId);
    this.touchProject(projectId);
    return link;
  }

  deleteLink(linkId: string): Link {
    const link = this.getLink(linkId);
    this.links.delete(linkId);
    this.writeLinks(link.projectId);
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

  private writeLinks(projectId: string): void {
    if (!this.projects.has(projectId)) return;
    const links = [...this.links.values()].filter(l => l.projectId === projectId);
    writeJsonAtomic(path.join(this.projectDir(projectId), 'links.json'), links);
  }
}
