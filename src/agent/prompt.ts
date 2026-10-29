import type { Workspace } from '../domain/workspace.js';
import { buildProjectContext } from '../domain/context.js';
import { describeScene } from '../core/describe.js';
import type { ServerElement } from '../types.js';
import type { ChatMessage } from './types.js';

// Standing instructions for the CLI agent. Claude Code receives them as an
// appended system prompt; Codex (no such flag) receives them in the first
// turn of each session.
export const AGENT_RULES = `You are the drawing partner inside Linemap, an Excalidraw-based diagram workbench the user is looking at in their browser right now.

How to work:
- The canvas shows one diagram at a time (the active diagram). Use the \`excalidraw\` MCP tools to read and change it: describe_scene to see it, batch_create_elements / update_element / delete_element / align_elements to change it, get_canvas_screenshot to check your work, open_diagram / create_diagram to switch or start another diagram in this project.
- Before a sizeable drawing, call read_diagram_guide once. After drawing, take a screenshot and fix truncated labels, overlaps and arrows crossing shapes.
- Keep what you learn in the workbench, not only in chat: add_note with elementIds for decisions and open questions (author: your model name), tag_elements for what shapes mean, link_diagrams when a shape deserves its own diagram, save_version after a meaningful change. Never confirm versions; the human does that.
- When the project has a linked folder, read it (files, search) to ground diagrams in the real code and cite file paths. You cannot edit files there and must not try.
- Reply in short plain prose. Say which shapes or diagrams you changed. Ask one question when the request is ambiguous instead of guessing big.`;

const MAX_SCENE_CHARS = 6000;

export interface TurnContext {
  projectId: string;
  diagramId: string | null;
  selectedIds: string[];
  includeBrain: boolean;
  includeRules: boolean;
  // Earlier turns of this chat that the current CLI session has not seen
  // (the user switched between Claude Code and Codex mid-chat).
  history?: ChatMessage[];
}

const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 700;

function historyBlock(messages: ChatMessage[]): string {
  const recent = messages.filter(m => m.status !== 'running' && m.text.trim()).slice(-MAX_HISTORY_MESSAGES);
  if (recent.length === 0) return '';
  const lines = recent.map(m => {
    const who = m.role === 'user' ? 'User' : `Agent (${m.runner === 'codex' ? 'Codex' : 'Claude Code'})`;
    const text = m.text.trim().replace(/\n{3,}/g, '\n\n');
    return `${who}: ${text.length > MAX_HISTORY_CHARS ? `${text.slice(0, MAX_HISTORY_CHARS)}…` : text}`;
  });
  return `<earlier-in-this-chat>\nYou are joining a conversation already in progress. What was said so far (the canvas below is the current state):\n\n${lines.join('\n\n')}\n</earlier-in-this-chat>`;
}

function label(element: ServerElement, byId: Map<string, ServerElement>): string {
  const own = element.label?.text ?? element.text;
  if (own) return own.replace(/\s+/g, ' ').slice(0, 60);
  const bound = (element.boundElements ?? []).find(b => b.type === 'text');
  const text = bound ? byId.get(bound.id)?.text : undefined;
  return text ? text.replace(/\s+/g, ' ').slice(0, 60) : element.type;
}

export function buildTurnPrompt(workspace: Workspace, context: TurnContext, userMessage: string): string {
  const { store } = workspace;
  const project = store.getProject(context.projectId);
  const activeId = workspace.activeDiagramId;
  const diagramId = context.diagramId ?? activeId;
  const blocks: string[] = [];

  if (context.includeRules) blocks.push(`<instructions>\n${AGENT_RULES}\n</instructions>`);
  if (context.includeBrain) {
    workspace.flush();
    blocks.push(`<project-brain>\n${buildProjectContext(store, project.id, { activeDiagramId: activeId })}\n</project-brain>`);
  }

  if (context.history?.length) {
    const block = historyBlock(context.history);
    if (block) blocks.push(block);
  }

  const lines: string[] = [];
  if (diagramId) {
    const meta = store.getDiagram(diagramId);
    const onCanvas = diagramId === activeId;
    lines.push(`The user is looking at diagram "${meta.name}" [${meta.id}] in project "${project.name}" [${project.id}]${onCanvas ? ', open on the canvas' : ' (not on the canvas; open_diagram it before drawing)'}.`);
    const scene = workspace.sceneFor(diagramId);
    const byId = new Map(scene.elements.map(el => [el.id, el]));
    const selected = context.selectedIds.map(id => byId.get(id)).filter((el): el is ServerElement => !!el);
    if (selected.length) {
      lines.push(`Selected on the canvas: ${selected.map(el => `"${label(el, byId)}" [${el.id}]`).join(', ')}. "This", "these" or "it" most likely refers to them.`);
    } else {
      lines.push('Nothing is selected on the canvas.');
    }
    let described = describeScene(scene.elements);
    if (described.length > MAX_SCENE_CHARS) described = `${described.slice(0, MAX_SCENE_CHARS)}\n… (truncated; call describe_scene for the rest)`;
    lines.push('', described);
  }
  if (project.rootPath) lines.push('', `Linked folder (read-only for you): ${project.rootPath}`);
  blocks.push(`<workbench-now>\n${lines.join('\n')}\n</workbench-now>`);

  blocks.push(userMessage.trim());
  return blocks.join('\n\n');
}
