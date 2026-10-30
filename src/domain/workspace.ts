import logger from '../utils/logger.js';
import { WorkspaceStore, NotFoundError, ValidationError } from './store.js';
import type { DiagramInput, VersionInput } from './store.js';
import type { Diagram, DiagramScene, VersionMeta } from './model.js';
import { normalizeTags } from './model.js';
import { elements, captureScene, loadScene, onSceneDirty, filesRecord, markSceneDirty } from '../server/live-scene.js';
import { broadcast } from '../server/broadcast.js';
import type { ServerElement } from '../types.js';

// Bridges the stored model and the live canvas. Exactly one diagram is
// "active": its working copy is what the tabs show and what the element
// routes mutate. Live edits are autosaved into that diagram; versions are
// explicit, immutable copies taken on request.

export interface WorkspaceOptions {
  autosaveMs?: number;
}

export interface TagUpdate {
  elementIds: string[];
  tags?: string[];
  addTags?: string[];
  removeTags?: string[];
  note?: string | null;
  diagramId?: string;
}

export class Workspace {
  readonly store: WorkspaceStore;
  private readonly autosaveMs: number;
  private autosaveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(store: WorkspaceStore, options: WorkspaceOptions = {}) {
    this.store = store;
    this.autosaveMs = options.autosaveMs ?? 400;
  }

  start(): void {
    this.store.load();
    this.ensureDefaults();
    const active = this.activeDiagram();
    if (active) loadScene(active.scene);
    onSceneDirty(() => this.scheduleAutosave());
    logger.info('Workspace ready', { activeDiagramId: active?.id ?? null, dataDir: this.store.dataDir });
  }

  // Land somewhere useful on first run: a project and an empty diagram.
  private ensureDefaults(): void {
    if (this.store.listProjects().length === 0) {
      const project = this.store.createProject({
        name: 'Scratchpad',
        description: 'A place to think out loud. Create a project when a domain takes shape.',
        tags: ['scratch']
      });
      const diagram = this.store.createDiagram(project.id, { name: 'Untitled' });
      this.store.setActiveDiagram(diagram.id);
      return;
    }
    if (this.store.getState().activeDiagramId) return;
    const projects = this.store.listProjects();
    for (const project of projects) {
      const [first] = this.store.listDiagrams(project.id);
      if (first) {
        this.store.setActiveDiagram(first.id);
        return;
      }
    }
    const diagram = this.store.createDiagram(projects[0]!.id, { name: 'Untitled' });
    this.store.setActiveDiagram(diagram.id);
  }

  get activeDiagramId(): string | null {
    return this.store.getState().activeDiagramId;
  }

  activeDiagram(): Diagram | null {
    const id = this.activeDiagramId;
    if (!id) return null;
    try {
      return this.store.getDiagram(id);
    } catch {
      return null;
    }
  }

  // ---- autosave -----------------------------------------------------------

  private scheduleAutosave(): void {
    this.dirty = true;
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.flush();
    }, this.autosaveMs);
    this.autosaveTimer.unref?.();
  }

  flush(): void {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (!this.dirty) return;
    const diagramId = this.activeDiagramId;
    this.dirty = false;
    if (!diagramId) return;
    try {
      const saved = this.store.saveDiagramScene(diagramId, captureScene());
      broadcast({
        type: 'workspace_event',
        event: 'diagram_saved',
        projectId: saved.projectId,
        diagramId,
        savedAt: saved.updatedAt,
        elementCount: saved.elementCount
      });
    } catch (error) {
      this.dirty = true;
      logger.error('Autosave failed:', error);
    }
  }

  // ---- active diagram -----------------------------------------------------

  openDiagram(diagramId: string): Diagram {
    const diagram = this.store.getDiagram(diagramId);
    if (diagram.id === this.activeDiagramId) {
      this.flush();
      return this.store.getDiagram(diagramId);
    }
    this.flush();
    this.store.setActiveDiagram(diagram.id);
    loadScene(diagram.scene);
    this.broadcastScene();
    this.broadcastActive();
    logger.info('Opened diagram on canvas', { diagramId: diagram.id, name: diagram.name });
    return diagram;
  }

  private broadcastScene(): void {
    const active = this.activeDiagram();
    broadcast({
      type: 'initial_elements',
      diagramId: active?.id ?? null,
      elements: Array.from(elements.values()),
      files: filesRecord()
    });
  }

  broadcastActive(): void {
    const active = this.activeDiagram();
    broadcast({
      type: 'workspace_event',
      event: 'active_changed',
      projectId: active?.projectId ?? null,
      diagramId: active?.id ?? null,
      diagramName: active?.name ?? null
    });
  }

  createDiagram(projectId: string, input: DiagramInput, open = true): Diagram {
    const diagram = this.store.createDiagram(projectId, input);
    broadcast({ type: 'workspace_event', event: 'diagram_changed', projectId, diagramId: diagram.id });
    return open ? this.openDiagram(diagram.id) : diagram;
  }

  deleteDiagram(diagramId: string): { deleted: Diagram; nowActive: Diagram | null } {
    const wasActive = diagramId === this.activeDiagramId;
    if (wasActive) this.dirty = false;
    const deleted = this.store.deleteDiagram(diagramId);
    broadcast({ type: 'workspace_event', event: 'diagram_changed', projectId: deleted.projectId, diagramId });
    let nowActive: Diagram | null = this.activeDiagram();
    if (wasActive) nowActive = this.activateFallback(deleted.projectId);
    return { deleted, nowActive };
  }

  deleteProject(projectId: string): { nowActive: Diagram | null } {
    const active = this.activeDiagram();
    const wasActive = active?.projectId === projectId;
    if (wasActive) this.dirty = false;
    this.store.deleteProject(projectId);
    broadcast({ type: 'workspace_event', event: 'project_changed', projectId });
    let nowActive: Diagram | null = this.activeDiagram();
    if (wasActive) nowActive = this.activateFallback(null);
    return { nowActive };
  }

  // After the active diagram disappears, land on a sibling, any diagram, or
  // a fresh one so the canvas is never pointing at nothing.
  private activateFallback(preferredProjectId: string | null): Diagram | null {
    const candidates = this.store.listAllDiagrams()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const sibling = preferredProjectId ? candidates.find(d => d.projectId === preferredProjectId) : undefined;
    const next = sibling ?? candidates[0];
    if (next) return this.openDiagram(next.id);
    this.ensureDefaults();
    const active = this.activeDiagram();
    if (active) {
      loadScene(active.scene);
      this.broadcastScene();
      this.broadcastActive();
    }
    return active;
  }

  // ---- scenes -------------------------------------------------------------

  sceneFor(diagramId: string): DiagramScene {
    if (diagramId === this.activeDiagramId) return captureScene();
    return structuredClone(this.store.getDiagram(diagramId).scene);
  }

  replaceScene(diagramId: string, scene: DiagramScene): Diagram {
    if (diagramId === this.activeDiagramId) {
      loadScene(scene);
      this.dirty = false;
      const diagram = this.store.saveDiagramScene(diagramId, captureScene());
      this.broadcastScene();
      return diagram;
    }
    return this.store.saveDiagramScene(diagramId, scene);
  }

  // ---- versions -----------------------------------------------------------

  saveVersion(diagramId: string, input: VersionInput): VersionMeta {
    if (diagramId === this.activeDiagramId) this.flush();
    const scene = this.sceneFor(diagramId);
    if (scene.elements.length === 0) {
      throw new ValidationError('Nothing to save: the diagram is empty');
    }
    const version = this.store.createVersion(diagramId, scene, input);
    broadcast({ type: 'workspace_event', event: 'version_changed', projectId: version.projectId, diagramId, versionId: version.id });
    return version;
  }

  restoreVersion(versionId: string, options: { saveCurrentAs?: string } = {}): { version: VersionMeta; diagram: Diagram } {
    const version = this.store.getVersion(versionId);
    if (options.saveCurrentAs && this.sceneFor(version.diagramId).elements.length > 0) {
      this.saveVersion(version.diagramId, { label: options.saveCurrentAs, note: `Auto-saved before restoring v${version.number}`, author: 'system' });
    }
    const diagram = this.replaceScene(version.diagramId, version.scene);
    const { scene: _scene, ...meta } = version;
    broadcast({ type: 'workspace_event', event: 'version_changed', projectId: version.projectId, diagramId: version.diagramId, versionId });
    return { version: meta, diagram };
  }

  updateVersion(versionId: string, patch: { confirmed?: boolean; label?: string; note?: string }): VersionMeta {
    const version = this.store.updateVersion(versionId, patch);
    broadcast({ type: 'workspace_event', event: 'version_changed', projectId: version.projectId, diagramId: version.diagramId, versionId });
    return version;
  }

  deleteVersion(versionId: string): VersionMeta {
    const version = this.store.deleteVersion(versionId);
    broadcast({ type: 'workspace_event', event: 'version_changed', projectId: version.projectId, diagramId: version.diagramId, versionId });
    return version;
  }

  // ---- element tags -------------------------------------------------------

  // Semantic tags and notes live in Excalidraw's own `customData`, which the
  // editor preserves through every edit, export and import. That makes them
  // visible to any tool reading the .excalidraw file, not just to us.
  tagElements(update: TagUpdate): ServerElement[] {
    const targetId = update.diagramId ?? this.activeDiagramId;
    if (!targetId) throw new ValidationError('No diagram is active');
    const live = targetId === this.activeDiagramId;
    const scene = live ? null : this.store.getDiagram(targetId).scene;
    const byId = live ? elements : new Map(scene!.elements.map(el => [el.id, el]));
    const updated: ServerElement[] = [];

    for (const id of update.elementIds) {
      const element = byId.get(id);
      if (!element) throw new NotFoundError(`Element ${id} not found in diagram ${targetId}`);
      const custom = { ...(element.customData ?? {}) } as Record<string, unknown>;
      let tags = normalizeTags(custom.tags);
      if (update.tags !== undefined) tags = normalizeTags(update.tags);
      if (update.addTags) tags = normalizeTags([...tags, ...update.addTags]);
      if (update.removeTags) {
        const remove = new Set(normalizeTags(update.removeTags));
        tags = tags.filter(t => !remove.has(t));
      }
      if (tags.length) custom.tags = tags; else delete custom.tags;
      if (update.note !== undefined) {
        if (update.note && update.note.trim()) custom.note = update.note.trim(); else delete custom.note;
      }
      const next: ServerElement = {
        ...element,
        customData: Object.keys(custom).length ? custom : null,
        updatedAt: new Date().toISOString(),
        version: (element.version || 0) + 1
      };
      byId.set(id, next);
      updated.push(next);
    }

    if (live) {
      for (const element of updated) broadcast({ type: 'element_updated', element });
      markSceneDirty();
    } else {
      this.store.saveDiagramScene(targetId, { elements: [...byId.values()], files: scene!.files });
    }
    return updated;
  }

  findByTag(tag: string, diagramId?: string): Array<{ diagramId: string; diagramName: string; element: ServerElement }> {
    const wanted = normalizeTags([tag])[0];
    if (!wanted) return [];
    const results: Array<{ diagramId: string; diagramName: string; element: ServerElement }> = [];
    const diagrams = diagramId ? [this.store.getDiagram(diagramId)] : this.store.listAllDiagrams().map(d => this.store.getDiagram(d.id));
    for (const diagram of diagrams) {
      const scene = this.sceneFor(diagram.id);
      for (const element of scene.elements) {
        const tags = normalizeTags((element.customData as { tags?: unknown } | null)?.tags);
        if (tags.includes(wanted)) results.push({ diagramId: diagram.id, diagramName: diagram.name, element });
      }
    }
    return results;
  }
}
