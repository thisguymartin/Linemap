import type { WorkspaceStore } from './store.js';
import type { DiagramMeta, Link, Note } from './model.js';
import type { ServerElement } from '../types.js';
import { displayPath, gitInfo, topLevelSummary } from './folder.js';

// The "brain dump": one markdown document an agent can read to orient itself
// in a project before touching the canvas. It is assembled from the stored
// model (diagrams, versions, notes, links, element tags), never from the live
// canvas, so it is cheap and consistent.

export interface ContextOptions {
  activeDiagramId?: string | null;
  maxNotes?: number;
}

function elementLabel(element: ServerElement): string {
  const text = element.label?.text ?? element.text;
  return text ? `"${text.replace(/\s+/g, ' ').slice(0, 60)}"` : element.type;
}

function tagsOf(element: ServerElement): string[] {
  const tags = (element.customData as { tags?: unknown } | null | undefined)?.tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
}

function noteOf(element: ServerElement): string | null {
  const note = (element.customData as { note?: unknown } | null | undefined)?.note;
  return typeof note === 'string' && note.trim() ? note.trim() : null;
}

function describeLinkEnd(diagrams: Map<string, DiagramMeta>, end: Link['from'], labels: Map<string, string>): string {
  const name = diagrams.get(end.diagramId)?.name ?? end.diagramId;
  if (!end.elementId) return name;
  const label = labels.get(`${end.diagramId}:${end.elementId}`);
  return `${name} › ${label ?? end.elementId}`;
}

export function buildProjectContext(store: WorkspaceStore, projectId: string, options: ContextOptions = {}): string {
  const project = store.getProject(projectId);
  const diagrams = new Map(project.diagrams.map(d => [d.id, d]));
  const links = project.links;
  const notes = store.listNotes(projectId);
  const maxNotes = options.maxNotes ?? 30;

  // Element labels and tags across every diagram in the project.
  const labels = new Map<string, string>();
  const tagIndex = new Map<string, string[]>();
  const elementNotes: string[] = [];
  for (const meta of project.diagrams) {
    const diagram = store.getDiagram(meta.id);
    for (const element of diagram.scene.elements) {
      const label = elementLabel(element);
      labels.set(`${diagram.id}:${element.id}`, label);
      for (const tag of tagsOf(element)) {
        const entries = tagIndex.get(tag) ?? [];
        entries.push(`${diagram.name} › ${label} [${element.id}]`);
        tagIndex.set(tag, entries);
      }
      const note = noteOf(element);
      if (note) elementNotes.push(`- ${diagram.name} › ${label} [${element.id}]: ${note}`);
    }
  }

  const lines: string[] = [];
  lines.push(`# Project: ${project.name}`);
  if (project.tags.length) lines.push(`Tags: ${project.tags.map(t => `#${t}`).join(' ')}`);
  lines.push(`Id: ${project.id} · slug: ${project.slug} · updated ${project.updatedAt}`);
  if (project.rootPath) {
    const git = gitInfo(project.rootPath);
    const gitBits = git.isRepo ? ` · git ${git.branch ?? '?'}${git.remote ? ` · ${git.remote}` : ''}` : '';
    lines.push(`Linked folder: ${displayPath(project.rootPath)} (${project.rootPath})${gitBits}`);
    const top = topLevelSummary(project.rootPath, 30);
    if (top.length) lines.push(`Folder top level: ${top.join('  ')}`);
  }
  if (project.description.trim()) {
    lines.push('');
    lines.push(project.description.trim());
  }

  lines.push('');
  lines.push(`## Diagrams (${project.diagrams.length})`);
  if (project.diagrams.length === 0) lines.push('_No diagrams yet. Create one with create_diagram._');
  for (const meta of project.diagrams) {
    const active = options.activeDiagramId === meta.id ? ' **(active on canvas)**' : '';
    const versionBits = meta.latestVersion
      ? `v${meta.latestVersion}${meta.latestConfirmedVersion ? ` (confirmed v${meta.latestConfirmedVersion})` : ' (unconfirmed)'}`
      : 'no saved versions';
    lines.push(`- **${meta.name}** [${meta.id}]${active} — ${meta.elementCount} elements, ${versionBits}${meta.tags.length ? `, tags: ${meta.tags.map(t => `#${t}`).join(' ')}` : ''}`);
    if (meta.description.trim()) lines.push(`  ${meta.description.trim().replace(/\n+/g, ' ')}`);
    const outgoing = links.filter(l => l.from.diagramId === meta.id);
    for (const link of outgoing) {
      lines.push(`  → ${link.relation} → ${describeLinkEnd(diagrams, link.to, labels)}${link.from.elementId ? ` (from ${labels.get(`${meta.id}:${link.from.elementId}`) ?? link.from.elementId})` : ''}${link.note ? ` — ${link.note}` : ''}`);
    }
  }

  if (tagIndex.size > 0) {
    lines.push('');
    lines.push('## Element tags');
    for (const [tag, entries] of [...tagIndex.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`- #${tag}: ${entries.join('; ')}`);
    }
  }

  if (elementNotes.length > 0) {
    lines.push('');
    lines.push('## Element notes');
    lines.push(...elementNotes);
  }

  lines.push('');
  lines.push(`## Conversation (${notes.length} notes${notes.length > maxNotes ? `, latest ${maxNotes} shown` : ''})`);
  if (notes.length === 0) lines.push('_No notes yet. Use add_note to leave context for the next agent or human._');
  const shown = notes.slice(-maxNotes);
  for (const note of shown) lines.push(formatNote(note, diagrams, labels));

  lines.push('');
  lines.push('## How to work here');
  lines.push('- `open_diagram` puts a diagram on the live canvas; drawing tools then operate on it.');
  lines.push('- `save_version` after meaningful progress; `confirm_version` once a human signs off.');
  lines.push('- `add_note` with elementIds to attach reasoning to specific shapes; `tag_elements` for semantic tags.');
  lines.push('- `link_diagrams` to connect a shape to a deeper diagram (drill-down) or relate two diagrams.');

  return lines.join('\n');
}

export function formatNote(note: Note, diagrams: Map<string, DiagramMeta>, labels: Map<string, string>): string {
  const where = note.diagramId ? `@${diagrams.get(note.diagramId)?.name ?? note.diagramId}` : '@project';
  const anchors = note.elementIds.length
    ? ` on ${note.elementIds.map(id => labels.get(`${note.diagramId}:${id}`) ?? id).join(', ')}`
    : '';
  const tags = note.tags.length ? ` ${note.tags.map(t => `#${t}`).join(' ')}` : '';
  const status = note.resolved ? ' ✓resolved' : '';
  const body = note.body.trim().replace(/\n+/g, ' ');
  return `- ${note.createdAt.slice(0, 16).replace('T', ' ')} ${note.role === 'agent' ? '🤖' : '🧑'} ${note.author} ${where}${anchors}${tags}${status}: ${body}`;
}
