import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import logger from '../utils/logger.js';
import * as ws from './workspace-client.js';
import { updateElementOnCanvas } from './canvas-client.js';
import { workspaceTools } from './mcp-workspace-tools.js';

const WORKSPACE_TOOL_NAMES = new Set(workspaceTools.map(t => t.name));

export function isWorkspaceTool(name: string): boolean {
  return WORKSPACE_TOOL_NAMES.has(name);
}

function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

function jsonResult(summary: string, value: unknown): CallToolResult {
  return text(`${summary}\n\n${JSON.stringify(value, null, 2)}`);
}

const tags = z.array(z.string()).optional();
const projectRef = z.string().optional();
const diagramRef = z.string().optional();

export async function callWorkspaceTool(name: string, args: Record<string, unknown> | undefined): Promise<CallToolResult> {
  const input = args ?? {};
  logger.info(`Handling workspace tool call: ${name}`);

  switch (name) {
    case 'list_projects': {
      const projects = await ws.listProjects();
      const info = await ws.getWorkspace();
      return jsonResult(`${projects.length} project(s). Active project: ${info.activeProjectId ?? 'none'}.`, projects);
    }
    case 'create_project': {
      const params = z.object({ name: z.string().min(1), description: z.string().optional(), tags, color: z.string().optional(), rootPath: z.string().optional() }).parse(input);
      const project = await ws.createProject(params);
      return jsonResult(`Project "${project.name}" created (${project.id}). Next: create_diagram to start drawing.`, project);
    }
    case 'get_project': {
      const { project } = z.object({ project: projectRef }).parse(input);
      const resolved = await ws.resolveProject(project);
      return jsonResult(`Project "${resolved.name}"`, await ws.getProject(resolved.id));
    }
    case 'update_project': {
      const { project, ...patch } = z.object({ project: projectRef, name: z.string().optional(), description: z.string().optional(), tags, color: z.string().optional() }).parse(input);
      const resolved = await ws.resolveProject(project);
      return jsonResult(`Project updated`, await ws.updateProject(resolved.id, patch));
    }
    case 'delete_project': {
      const { project, confirm } = z.object({ project: z.string(), confirm: z.boolean() }).parse(input);
      if (!confirm) throw new Error('delete_project requires confirm: true');
      const resolved = await ws.resolveProject(project);
      const result = await ws.deleteProject(resolved.id);
      return jsonResult(`Project "${resolved.name}" deleted. Canvas now shows diagram ${result.activeDiagramId ?? 'none'}.`, result);
    }
    case 'link_project_folder': {
      const { project, path } = z.object({ project: projectRef, path: z.string() }).parse(input);
      const resolved = await ws.resolveProject(project);
      const updated = await ws.updateProject(resolved.id, { rootPath: path.trim() ? path : null });
      return jsonResult(updated.rootPath ? `"${updated.name}" now points at ${updated.rootPath}.` : `"${updated.name}" has no linked folder now.`, { id: updated.id, rootPath: updated.rootPath });
    }
    case 'get_project_context': {
      const { project } = z.object({ project: projectRef }).parse(input);
      const resolved = await ws.resolveProject(project);
      return text(await ws.getProjectContext(resolved.id));
    }
    case 'list_diagrams': {
      const { project } = z.object({ project: projectRef }).parse(input);
      const resolved = await ws.resolveProject(project);
      const diagrams = await ws.listDiagrams(resolved.id);
      const info = await ws.getWorkspace();
      return jsonResult(`${diagrams.length} diagram(s) in "${resolved.name}". Active: ${info.activeDiagramId ?? 'none'}.`, diagrams);
    }
    case 'create_diagram': {
      const { project, open, ...rest } = z.object({ name: z.string().min(1), project: projectRef, description: z.string().optional(), tags, open: z.boolean().optional() }).parse(input);
      const resolved = await ws.resolveProject(project);
      const { diagram, active } = await ws.createDiagram(resolved.id, { ...rest, open: open ?? true });
      return jsonResult(
        `Diagram "${diagram.name}" created in "${resolved.name}"${active ? ' and opened on the canvas' : ''}. Browser: ${ws.diagramUrl(resolved.id, diagram.id)}`,
        diagram
      );
    }
    case 'open_diagram': {
      const { diagram, project } = z.object({ diagram: z.string(), project: projectRef }).parse(input);
      const resolved = await ws.resolveDiagram(diagram, project);
      const opened = await ws.openDiagram(resolved.id);
      return jsonResult(`"${opened.name}" is now on the canvas (${opened.elementCount} elements). Browser: ${ws.diagramUrl(opened.projectId, opened.id)}`, opened);
    }
    case 'get_active_diagram': {
      const info = await ws.getWorkspace();
      if (!info.activeDiagram) return text('No diagram is active. Use list_projects / open_diagram.');
      const project = await ws.resolveProject(info.activeProjectId ?? undefined);
      return jsonResult(
        `Canvas shows "${info.activeDiagram.name}" in project "${project.name}". Browser: ${ws.diagramUrl(project.id, info.activeDiagram.id)}`,
        { project: { id: project.id, name: project.name, slug: project.slug, tags: project.tags }, diagram: info.activeDiagram, dataDir: info.dataDir }
      );
    }
    case 'update_diagram': {
      const { diagram, project, ...patch } = z.object({ diagram: diagramRef, project: projectRef, name: z.string().optional(), description: z.string().optional(), tags }).parse(input);
      const resolved = await ws.resolveDiagram(diagram, project);
      return jsonResult('Diagram updated', await ws.updateDiagram(resolved.id, patch));
    }
    case 'delete_diagram': {
      const { diagram, project, confirm } = z.object({ diagram: z.string(), project: projectRef, confirm: z.boolean() }).parse(input);
      if (!confirm) throw new Error('delete_diagram requires confirm: true');
      const resolved = await ws.resolveDiagram(diagram, project);
      const result = await ws.deleteDiagram(resolved.id);
      return jsonResult(`Diagram "${resolved.name}" deleted. Canvas now shows ${result.activeDiagramId ?? 'nothing'}.`, result);
    }
    case 'save_version': {
      const { diagram, ...rest } = z.object({ diagram: diagramRef, label: z.string().optional(), note: z.string().optional(), author: z.string().optional(), confirm: z.boolean().optional() }).parse(input);
      const resolved = await ws.resolveDiagram(diagram);
      const version = await ws.saveVersion(resolved.id, { author: 'agent', ...rest });
      return jsonResult(`Saved v${version.number} "${version.label}" of "${resolved.name}" (${version.elementCount} elements${version.confirmed ? ', confirmed' : ', awaiting human confirmation'}).`, version);
    }
    case 'list_versions': {
      const { diagram } = z.object({ diagram: diagramRef }).parse(input);
      const resolved = await ws.resolveDiagram(diagram);
      const versions = await ws.listVersions(resolved.id);
      return jsonResult(`${versions.length} version(s) of "${resolved.name}".`, versions);
    }
    case 'confirm_version': {
      const { version, diagram, confirmed } = z.object({ version: z.string(), diagram: diagramRef, confirmed: z.boolean().optional() }).parse(input);
      const resolved = await ws.resolveDiagram(diagram);
      const target = await ws.resolveVersion(version, resolved.id);
      const updated = await ws.updateVersion(target.id, { confirmed: confirmed ?? true });
      return jsonResult(`v${updated.number} is now ${updated.confirmed ? 'confirmed' : 'unconfirmed'}.`, updated);
    }
    case 'restore_version': {
      const { version, diagram, saveCurrentAs } = z.object({ version: z.string(), diagram: diagramRef, saveCurrentAs: z.string().optional() }).parse(input);
      const resolved = await ws.resolveDiagram(diagram);
      const target = await ws.resolveVersion(version, resolved.id);
      const result = await ws.restoreVersion(target.id, saveCurrentAs);
      return jsonResult(`Restored v${result.version.number} "${result.version.label}" into "${result.diagram.name}" (${result.diagram.elementCount} elements).`, result);
    }
    case 'delete_version': {
      const { version, diagram } = z.object({ version: z.string(), diagram: diagramRef }).parse(input);
      const resolved = await ws.resolveDiagram(diagram);
      const target = await ws.resolveVersion(version, resolved.id);
      const deleted = await ws.deleteVersion(target.id);
      return jsonResult(`Deleted v${deleted.number} "${deleted.label}".`, deleted);
    }
    case 'add_note': {
      const params = z.object({
        body: z.string().min(1),
        diagram: diagramRef,
        project: projectRef,
        elementIds: z.array(z.string()).optional(),
        tags,
        author: z.string().optional(),
        projectLevel: z.boolean().optional()
      }).parse(input);
      let projectId: string;
      let diagramId: string | null = null;
      if (params.projectLevel) {
        projectId = (await ws.resolveProject(params.project)).id;
      } else {
        const resolved = await ws.resolveDiagram(params.diagram, params.project);
        projectId = resolved.projectId;
        diagramId = resolved.id;
      }
      const note = await ws.addNote(projectId, {
        diagramId,
        body: params.body,
        author: params.author ?? 'agent',
        role: 'agent',
        elementIds: params.elementIds,
        tags: params.tags
      });
      return jsonResult(`Note added${diagramId ? ' to the diagram' : ' to the project'}${note.elementIds.length ? ` on ${note.elementIds.join(', ')}` : ''}.`, note);
    }
    case 'list_notes': {
      const params = z.object({ project: projectRef, diagram: diagramRef, elementId: z.string().optional(), includeResolved: z.boolean().optional() }).parse(input);
      let projectId: string;
      const filter: { diagramId?: string; elementId?: string } = {};
      if (params.diagram) {
        const resolved = await ws.resolveDiagram(params.diagram, params.project);
        projectId = resolved.projectId;
        filter.diagramId = resolved.id;
      } else {
        projectId = (await ws.resolveProject(params.project)).id;
      }
      if (params.elementId) filter.elementId = params.elementId;
      const notes = (await ws.listNotes(projectId, filter)).filter(n => params.includeResolved || !n.resolved);
      const open = notes.filter(n => n.role === 'human' && !n.resolved).length;
      return jsonResult(`${notes.length} note(s)${open ? `, ${open} open human note(s) to answer` : ''}.`, notes);
    }
    case 'resolve_note': {
      const { noteId, resolved } = z.object({ noteId: z.string(), resolved: z.boolean().optional() }).parse(input);
      return jsonResult('Note updated', await ws.updateNote(noteId, { resolved: resolved ?? true }));
    }
    case 'tag_elements': {
      const { diagram, ...rest } = z.object({
        elementIds: z.array(z.string()).min(1),
        tags,
        addTags: z.array(z.string()).optional(),
        removeTags: z.array(z.string()).optional(),
        note: z.string().optional(),
        diagram: diagramRef
      }).parse(input);
      const resolved = diagram ? await ws.resolveDiagram(diagram) : null;
      const elements = await ws.tagElements({ ...rest, ...(resolved ? { diagramId: resolved.id } : {}) });
      return jsonResult(`Tagged ${elements.length} element(s).`, elements.map(el => ({ id: el.id, type: el.type, customData: el.customData })));
    }
    case 'find_by_tag': {
      const { tag, diagram } = z.object({ tag: z.string(), diagram: diagramRef }).parse(input);
      const resolved = diagram ? await ws.resolveDiagram(diagram) : null;
      const results = await ws.findByTag(tag, resolved?.id);
      return jsonResult(`${results.length} element(s) tagged #${tag}.`, results.map(r => ({
        diagramId: r.diagramId,
        diagramName: r.diagramName,
        id: r.element.id,
        type: r.element.type,
        label: r.element.label?.text ?? r.element.text ?? null,
        customData: r.element.customData
      })));
    }
    case 'link_diagrams': {
      const params = z.object({
        fromDiagram: diagramRef,
        fromElementId: z.string().optional(),
        toDiagram: z.string(),
        toElementId: z.string().optional(),
        relation: z.string().optional(),
        note: z.string().optional(),
        project: projectRef
      }).parse(input);
      const from = await ws.resolveDiagram(params.fromDiagram, params.project);
      const to = await ws.resolveDiagram(params.toDiagram, params.project ?? from.projectId);
      const link = await ws.createLink(from.projectId, {
        from: { diagramId: from.id, ...(params.fromElementId ? { elementId: params.fromElementId } : {}) },
        to: { diagramId: to.id, ...(params.toElementId ? { elementId: params.toElementId } : {}) },
        relation: params.relation,
        note: params.note
      });
      let elementLinked = false;
      if (params.fromElementId) {
        const info = await ws.getWorkspace();
        if (info.activeDiagramId === from.id) {
          const updated = await updateElementOnCanvas({ id: params.fromElementId, link: `/p/${to.projectId}/d/${to.id}` } as never);
          elementLinked = !!updated;
        }
      }
      return jsonResult(
        `Linked "${from.name}"${params.fromElementId ? ` › ${params.fromElementId}` : ''} ${link.relation} "${to.name}".${elementLinked ? ' The shape now links to the target diagram in the browser.' : ''}`,
        link
      );
    }
    case 'list_links': {
      const { project, diagram } = z.object({ project: projectRef, diagram: diagramRef }).parse(input);
      let projectId: string;
      let diagramId: string | undefined;
      if (diagram) {
        const resolved = await ws.resolveDiagram(diagram, project);
        projectId = resolved.projectId;
        diagramId = resolved.id;
      } else {
        projectId = (await ws.resolveProject(project)).id;
      }
      const links = await ws.listLinks(projectId, diagramId);
      return jsonResult(`${links.length} link(s).`, links);
    }
    case 'delete_link': {
      const { linkId } = z.object({ linkId: z.string() }).parse(input);
      return jsonResult('Link deleted', await ws.deleteLink(linkId));
    }
    default:
      throw new Error(`Unknown workspace tool: ${name}`);
  }
}
