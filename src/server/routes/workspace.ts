import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import type { Workspace } from '../../domain/workspace.js';
import { buildProjectContext } from '../../domain/context.js';
import { param, queryString, sendError } from '../http.js';
import { broadcast } from '../broadcast.js';
import { folderInfo } from './agent.js';

const projectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  color: z.string().optional(),
  rootPath: z.string().max(4096).nullable().optional()
});

const diagramInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  open: z.boolean().optional(),
  scene: z.object({
    elements: z.array(z.looseObject({ id: z.string(), type: z.string(), x: z.number(), y: z.number() })),
    files: z.record(z.string(), z.any()).optional()
  }).optional()
});

const versionInput = z.object({
  label: z.string().max(120).optional(),
  note: z.string().max(5000).optional(),
  author: z.string().max(80).optional(),
  confirm: z.boolean().optional()
});

const noteInput = z.object({
  diagramId: z.string().nullable().optional(),
  body: z.string().min(1).max(20000),
  author: z.string().max(80).optional(),
  role: z.enum(['human', 'agent']).optional(),
  elementIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
});

const linkEnd = z.object({ diagramId: z.string(), elementId: z.string().optional() });
const linkInput = z.object({
  from: linkEnd,
  to: linkEnd,
  relation: z.string().max(60).optional(),
  note: z.string().max(2000).optional()
});

const tagInput = z.object({
  elementIds: z.array(z.string()).min(1),
  tags: z.array(z.string()).optional(),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  diagramId: z.string().optional()
});

export function registerWorkspaceRoutes(app: Express, workspace: Workspace): void {
  const { store } = workspace;

  app.get('/api/workspace', (_req: Request, res: Response) => {
    const active = workspace.activeDiagram();
    res.json({
      success: true,
      activeDiagramId: active?.id ?? null,
      activeProjectId: active?.projectId ?? null,
      activeDiagram: active ? store.diagramMeta(active) : null,
      dataDir: store.dataDir
    });
  });

  // ---- projects -----------------------------------------------------------

  app.get('/api/projects', (_req: Request, res: Response) => {
    res.json({ success: true, projects: store.listProjects() });
  });

  app.post('/api/projects', (req: Request, res: Response) => {
    try {
      const input = projectInput.parse(req.body ?? {});
      const project = store.createProject(input);
      broadcast({ type: 'workspace_event', event: 'project_changed', projectId: project.id });
      const detail = store.getProject(project.id);
      res.status(201).json({ success: true, project: { ...detail, folder: folderInfo(detail.rootPath) } });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/projects/:pid', (req: Request, res: Response) => {
    try {
      workspace.flush();
      const detail = store.getProject(param(req, 'pid'));
      res.json({ success: true, project: { ...detail, folder: folderInfo(detail.rootPath) } });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/projects/:pid', (req: Request, res: Response) => {
    try {
      const patch = projectInput.partial().parse(req.body ?? {});
      const project = store.updateProject(param(req, 'pid'), patch);
      broadcast({ type: 'workspace_event', event: 'project_changed', projectId: project.id });
      const detail = store.getProject(project.id);
      res.json({ success: true, project: { ...detail, folder: folderInfo(detail.rootPath) } });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.delete('/api/projects/:pid', (req: Request, res: Response) => {
    try {
      const { nowActive } = workspace.deleteProject(param(req, 'pid'));
      res.json({ success: true, activeDiagramId: nowActive?.id ?? null, activeProjectId: nowActive?.projectId ?? null });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/projects/:pid/context', (req: Request, res: Response) => {
    try {
      workspace.flush();
      const markdown = buildProjectContext(store, param(req, 'pid'), { activeDiagramId: workspace.activeDiagramId });
      res.json({ success: true, markdown });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- diagrams -----------------------------------------------------------

  app.get('/api/projects/:pid/diagrams', (req: Request, res: Response) => {
    try {
      workspace.flush();
      res.json({ success: true, diagrams: store.listDiagrams(param(req, 'pid')) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/projects/:pid/diagrams', (req: Request, res: Response) => {
    try {
      const { open, scene, ...input } = diagramInput.parse(req.body ?? {});
      const diagram = workspace.createDiagram(
        param(req, 'pid'),
        { ...input, ...(scene ? { scene: { elements: scene.elements as never, files: scene.files ?? {} } } : {}) },
        open ?? true
      );
      res.status(201).json({ success: true, diagram: store.diagramMeta(diagram), active: diagram.id === workspace.activeDiagramId });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/diagrams/:did', (req: Request, res: Response) => {
    try {
      workspace.flush();
      const diagram = store.getDiagram(param(req, 'did'));
      const withScene = queryString(req, 'scene') === '1';
      res.json({
        success: true,
        diagram: store.diagramMeta(diagram),
        active: diagram.id === workspace.activeDiagramId,
        ...(withScene ? { scene: workspace.sceneFor(diagram.id) } : {})
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/diagrams/:did', (req: Request, res: Response) => {
    try {
      const patch = diagramInput.omit({ open: true, scene: true }).partial().parse(req.body ?? {});
      const diagram = store.updateDiagram(param(req, 'did'), patch);
      broadcast({ type: 'workspace_event', event: 'diagram_changed', projectId: diagram.projectId, diagramId: diagram.id });
      if (diagram.id === workspace.activeDiagramId) workspace.broadcastActive();
      res.json({ success: true, diagram: store.diagramMeta(diagram) });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.delete('/api/diagrams/:did', (req: Request, res: Response) => {
    try {
      const { deleted, nowActive } = workspace.deleteDiagram(param(req, 'did'));
      res.json({ success: true, deleted: store.diagramMeta(deleted), activeDiagramId: nowActive?.id ?? null });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/diagrams/:did/open', (req: Request, res: Response) => {
    try {
      const diagram = workspace.openDiagram(param(req, 'did'));
      res.json({ success: true, diagram: store.diagramMeta(diagram) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put('/api/diagrams/:did/scene', (req: Request, res: Response) => {
    try {
      const scene = diagramInput.shape.scene.unwrap().parse(req.body ?? {});
      const diagram = workspace.replaceScene(param(req, 'did'), { elements: scene.elements as never, files: scene.files ?? {} });
      res.json({ success: true, diagram: store.diagramMeta(diagram) });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  // ---- versions -----------------------------------------------------------

  app.get('/api/diagrams/:did/versions', (req: Request, res: Response) => {
    try {
      res.json({ success: true, versions: store.listVersions(param(req, 'did')) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/diagrams/:did/versions', (req: Request, res: Response) => {
    try {
      const input = versionInput.parse(req.body ?? {});
      const version = workspace.saveVersion(param(req, 'did'), input);
      res.status(201).json({ success: true, version });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/versions/:vid', (req: Request, res: Response) => {
    try {
      const version = store.getVersion(param(req, 'vid'));
      const withScene = queryString(req, 'scene') !== '0';
      const { scene, ...meta } = version;
      res.json({ success: true, version: withScene ? { ...meta, scene } : meta });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/versions/:vid', (req: Request, res: Response) => {
    try {
      const patch = z.object({ confirmed: z.boolean().optional(), label: z.string().max(120).optional(), note: z.string().max(5000).optional() }).parse(req.body ?? {});
      res.json({ success: true, version: workspace.updateVersion(param(req, 'vid'), patch) });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.post('/api/versions/:vid/restore', (req: Request, res: Response) => {
    try {
      const { saveCurrentAs } = z.object({ saveCurrentAs: z.string().max(120).optional() }).parse(req.body ?? {});
      const result = workspace.restoreVersion(param(req, 'vid'), { saveCurrentAs });
      res.json({ success: true, version: result.version, diagram: store.diagramMeta(result.diagram) });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.delete('/api/versions/:vid', (req: Request, res: Response) => {
    try {
      res.json({ success: true, deleted: workspace.deleteVersion(param(req, 'vid')) });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- notes --------------------------------------------------------------

  app.get('/api/projects/:pid/notes', (req: Request, res: Response) => {
    try {
      const diagramId = queryString(req, 'diagramId');
      const elementId = queryString(req, 'elementId');
      const notes = store.listNotes(param(req, 'pid'), {
        ...(diagramId !== undefined ? { diagramId: diagramId === 'null' || diagramId === '' ? null : diagramId } : {}),
        ...(elementId ? { elementId } : {})
      });
      res.json({ success: true, notes });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/projects/:pid/notes', (req: Request, res: Response) => {
    try {
      const input = noteInput.parse(req.body ?? {});
      const note = store.createNote(param(req, 'pid'), input);
      broadcast({ type: 'workspace_event', event: 'note_changed', projectId: note.projectId, diagramId: note.diagramId, noteId: note.id });
      res.status(201).json({ success: true, note });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.patch('/api/notes/:nid', (req: Request, res: Response) => {
    try {
      const patch = z.object({
        body: z.string().min(1).max(20000).optional(),
        resolved: z.boolean().optional(),
        tags: z.array(z.string()).optional(),
        elementIds: z.array(z.string()).optional()
      }).parse(req.body ?? {});
      const note = store.updateNote(param(req, 'nid'), patch);
      broadcast({ type: 'workspace_event', event: 'note_changed', projectId: note.projectId, diagramId: note.diagramId, noteId: note.id });
      res.json({ success: true, note });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.delete('/api/notes/:nid', (req: Request, res: Response) => {
    try {
      const note = store.deleteNote(param(req, 'nid'));
      broadcast({ type: 'workspace_event', event: 'note_changed', projectId: note.projectId, diagramId: note.diagramId, noteId: note.id });
      res.json({ success: true, deleted: note });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- links --------------------------------------------------------------

  app.get('/api/projects/:pid/links', (req: Request, res: Response) => {
    try {
      res.json({ success: true, links: store.listLinks(param(req, 'pid'), queryString(req, 'diagramId')) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/projects/:pid/links', (req: Request, res: Response) => {
    try {
      const input = linkInput.parse(req.body ?? {});
      const link = store.createLink(param(req, 'pid'), input);
      broadcast({ type: 'workspace_event', event: 'link_changed', projectId: link.projectId, linkId: link.id });
      res.status(201).json({ success: true, link });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.delete('/api/links/:lid', (req: Request, res: Response) => {
    try {
      const link = store.deleteLink(param(req, 'lid'));
      broadcast({ type: 'workspace_event', event: 'link_changed', projectId: link.projectId, linkId: link.id });
      res.json({ success: true, deleted: link });
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---- element tags -------------------------------------------------------

  app.post('/api/elements/tags', (req: Request, res: Response) => {
    try {
      const input = tagInput.parse(req.body ?? {});
      const updated = workspace.tagElements(input);
      res.json({ success: true, elements: updated, count: updated.length });
    } catch (error) {
      sendError(res, error, 400);
    }
  });

  app.get('/api/tags/:tag', (req: Request, res: Response) => {
    try {
      const results = workspace.findByTag(param(req, 'tag'), queryString(req, 'diagramId'));
      res.json({ success: true, results, count: results.length });
    } catch (error) {
      sendError(res, error);
    }
  });
}
