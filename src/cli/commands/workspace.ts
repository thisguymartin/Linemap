import path from 'path';
import { parseArgs, CliUsageError } from '../args.js';
import { printJson, note } from '../util.js';
import { ensureCanvasRunning } from '../../core/spawn.js';
import * as ws from '../../core/workspace-client.js';

// CLI surface for the workspace: the same operations as the MCP tools, as
// subcommands with JSON output. Refs accept ids, slugs or names.

function csv(value: string | boolean | string[] | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function str(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const REF_FLAGS = { project: { takesValue: true }, diagram: { takesValue: true } };

export async function project(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    description: { takesValue: true }, tags: { takesValue: true }, color: { takesValue: true }, name: { takesValue: true }, yes: { takesValue: false }, folder: { takesValue: true }
  });
  const [action, ref, extra] = positionals;
  await ensureCanvasRunning();
  switch (action) {
    case 'list':
    case undefined:
      printJson(await ws.listProjects());
      return;
    case 'create': {
      if (!ref) throw new CliUsageError('Usage: project create <name> [--description ...] [--tags a,b]');
      printJson(await ws.createProject({ name: ref, description: str(flags.description), tags: csv(flags.tags), color: str(flags.color), rootPath: str(flags.folder) ? path.resolve(str(flags.folder)!) : undefined }));
      return;
    }
    case 'show':
    case 'get': {
      const resolved = await ws.resolveProject(ref);
      printJson(await ws.getProject(resolved.id));
      return;
    }
    case 'update': {
      const resolved = await ws.resolveProject(ref);
      printJson(await ws.updateProject(resolved.id, { name: str(flags.name), description: str(flags.description), tags: csv(flags.tags), color: str(flags.color) }));
      return;
    }
    case 'link': {
      // project link [ref] <path>   (ref optional: defaults to the active project)
      const target = extra ?? ref;
      if (!target) throw new CliUsageError('Usage: project link [ref] <folder>');
      const resolved = await ws.resolveProject(extra ? ref : undefined);
      printJson(await ws.updateProject(resolved.id, { rootPath: path.resolve(target) }));
      return;
    }
    case 'unlink': {
      const resolved = await ws.resolveProject(ref);
      printJson(await ws.updateProject(resolved.id, { rootPath: null }));
      return;
    }
    case 'delete': {
      if (!ref) throw new CliUsageError('Usage: project delete <ref> --yes');
      if (!flags.yes) throw new CliUsageError('Deleting a project removes every diagram in it. Add --yes to confirm.');
      const resolved = await ws.resolveProject(ref);
      printJson(await ws.deleteProject(resolved.id));
      return;
    }
    default:
      throw new CliUsageError('Usage: project list|create|show|update|link|unlink|delete [ref]');
  }
}

export async function diagram(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    ...REF_FLAGS, description: { takesValue: true }, tags: { takesValue: true }, name: { takesValue: true }, yes: { takesValue: false }, 'no-open': { takesValue: false }
  });
  const [action, ref] = positionals;
  await ensureCanvasRunning();
  switch (action) {
    case 'list':
    case undefined: {
      const resolved = await ws.resolveProject(str(flags.project));
      printJson(await ws.listDiagrams(resolved.id));
      return;
    }
    case 'create': {
      if (!ref) throw new CliUsageError('Usage: diagram create <name> [--project ref] [--description ...] [--tags a,b] [--no-open]');
      const resolved = await ws.resolveProject(str(flags.project));
      printJson(await ws.createDiagram(resolved.id, { name: ref, description: str(flags.description), tags: csv(flags.tags), open: !flags['no-open'] }));
      return;
    }
    case 'open': {
      if (!ref) throw new CliUsageError('Usage: diagram open <ref> [--project ref]');
      const resolved = await ws.resolveDiagram(ref, str(flags.project));
      const opened = await ws.openDiagram(resolved.id);
      note(`Canvas: ${ws.diagramUrl(opened.projectId, opened.id)}`);
      printJson(opened);
      return;
    }
    case 'show':
    case 'get': {
      const resolved = await ws.resolveDiagram(ref, str(flags.project));
      printJson(await ws.getDiagram(resolved.id, true));
      return;
    }
    case 'active': {
      printJson(await ws.getWorkspace());
      return;
    }
    case 'update': {
      const resolved = await ws.resolveDiagram(ref, str(flags.project));
      printJson(await ws.updateDiagram(resolved.id, { name: str(flags.name), description: str(flags.description), tags: csv(flags.tags) }));
      return;
    }
    case 'delete': {
      if (!ref) throw new CliUsageError('Usage: diagram delete <ref> --yes');
      if (!flags.yes) throw new CliUsageError('Deleting a diagram removes its versions and notes. Add --yes to confirm.');
      const resolved = await ws.resolveDiagram(ref, str(flags.project));
      printJson(await ws.deleteDiagram(resolved.id));
      return;
    }
    default:
      throw new CliUsageError('Usage: diagram list|create|open|show|active|update|delete [ref]');
  }
}

export async function version(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    ...REF_FLAGS, label: { takesValue: true }, note: { takesValue: true }, author: { takesValue: true }, confirm: { takesValue: false }, unconfirm: { takesValue: false }, 'save-current': { takesValue: true }
  });
  const [action, ref] = positionals;
  await ensureCanvasRunning();
  const target = await ws.resolveDiagram(str(flags.diagram), str(flags.project));
  switch (action) {
    case 'list':
    case undefined:
      printJson(await ws.listVersions(target.id));
      return;
    case 'save':
      printJson(await ws.saveVersion(target.id, { label: ref ?? str(flags.label), note: str(flags.note), author: str(flags.author) ?? 'human', confirm: !!flags.confirm }));
      return;
    case 'confirm': {
      if (!ref) throw new CliUsageError('Usage: version confirm <id|number> [--unconfirm]');
      const v = await ws.resolveVersion(ref, target.id);
      printJson(await ws.updateVersion(v.id, { confirmed: !flags.unconfirm }));
      return;
    }
    case 'restore': {
      if (!ref) throw new CliUsageError('Usage: version restore <id|number> [--save-current label]');
      const v = await ws.resolveVersion(ref, target.id);
      printJson(await ws.restoreVersion(v.id, str(flags['save-current'])));
      return;
    }
    case 'show': {
      if (!ref) throw new CliUsageError('Usage: version show <id|number>');
      const v = await ws.resolveVersion(ref, target.id);
      printJson(await ws.getVersion(v.id));
      return;
    }
    case 'delete': {
      if (!ref) throw new CliUsageError('Usage: version delete <id|number>');
      const v = await ws.resolveVersion(ref, target.id);
      printJson(await ws.deleteVersion(v.id));
      return;
    }
    default:
      throw new CliUsageError('Usage: version list|save|confirm|restore|show|delete [ref] [--diagram ref]');
  }
}

export async function notes(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    ...REF_FLAGS, elements: { takesValue: true }, element: { takesValue: true }, tags: { takesValue: true }, author: { takesValue: true }, agent: { takesValue: false }, 'project-level': { takesValue: false }, all: { takesValue: false }
  });
  const [action, body] = positionals;
  await ensureCanvasRunning();
  switch (action) {
    case 'list':
    case undefined: {
      let projectId: string;
      const filter: { diagramId?: string; elementId?: string } = {};
      if (flags.diagram || !flags.project) {
        const d = await ws.resolveDiagram(str(flags.diagram), str(flags.project));
        projectId = d.projectId;
        if (flags.diagram || !flags['project-level']) filter.diagramId = d.id;
      } else {
        projectId = (await ws.resolveProject(str(flags.project))).id;
      }
      if (flags.element) filter.elementId = str(flags.element);
      const list = await ws.listNotes(projectId, filter);
      printJson(flags.all ? list : list.filter(n => !n.resolved));
      return;
    }
    case 'add': {
      if (!body) throw new CliUsageError('Usage: note add "text" [--diagram ref] [--elements a,b] [--tags x,y] [--agent] [--author name]');
      let projectId: string;
      let diagramId: string | null = null;
      if (flags['project-level']) {
        projectId = (await ws.resolveProject(str(flags.project))).id;
      } else {
        const d = await ws.resolveDiagram(str(flags.diagram), str(flags.project));
        projectId = d.projectId;
        diagramId = d.id;
      }
      printJson(await ws.addNote(projectId, {
        diagramId,
        body,
        role: flags.agent ? 'agent' : 'human',
        author: str(flags.author),
        elementIds: csv(flags.elements),
        tags: csv(flags.tags)
      }));
      return;
    }
    case 'resolve':
      if (!body) throw new CliUsageError('Usage: note resolve <noteId>');
      printJson(await ws.updateNote(body, { resolved: true }));
      return;
    case 'reopen':
      if (!body) throw new CliUsageError('Usage: note reopen <noteId>');
      printJson(await ws.updateNote(body, { resolved: false }));
      return;
    case 'delete':
      if (!body) throw new CliUsageError('Usage: note delete <noteId>');
      printJson(await ws.deleteNote(body));
      return;
    default:
      throw new CliUsageError('Usage: note list|add|resolve|reopen|delete');
  }
}

export async function link(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    ...REF_FLAGS, from: { takesValue: true }, to: { takesValue: true }, 'from-element': { takesValue: true }, 'to-element': { takesValue: true }, relation: { takesValue: true }, note: { takesValue: true }
  });
  const [action, ref] = positionals;
  await ensureCanvasRunning();
  switch (action) {
    case 'list':
    case undefined: {
      if (flags.diagram) {
        const d = await ws.resolveDiagram(str(flags.diagram), str(flags.project));
        printJson(await ws.listLinks(d.projectId, d.id));
      } else {
        printJson(await ws.listLinks((await ws.resolveProject(str(flags.project))).id));
      }
      return;
    }
    case 'add': {
      if (!flags.to) throw new CliUsageError('Usage: link add --to <diagram> [--from <diagram>] [--from-element id] [--to-element id] [--relation r]');
      const from = await ws.resolveDiagram(str(flags.from), str(flags.project));
      const to = await ws.resolveDiagram(str(flags.to), str(flags.project) ?? from.projectId);
      printJson(await ws.createLink(from.projectId, {
        from: { diagramId: from.id, ...(flags['from-element'] ? { elementId: str(flags['from-element'])! } : {}) },
        to: { diagramId: to.id, ...(flags['to-element'] ? { elementId: str(flags['to-element'])! } : {}) },
        relation: str(flags.relation),
        note: str(flags.note)
      }));
      return;
    }
    case 'delete':
      if (!ref) throw new CliUsageError('Usage: link delete <linkId>');
      printJson(await ws.deleteLink(ref));
      return;
    default:
      throw new CliUsageError('Usage: link list|add|delete');
  }
}

export async function tag(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    ...REF_FLAGS, ids: { takesValue: true }, set: { takesValue: true }, add: { takesValue: true }, remove: { takesValue: true }, note: { takesValue: true }
  });
  const [action, ref] = positionals;
  await ensureCanvasRunning();
  switch (action) {
    case 'set':
    case 'add':
    case 'remove': {
      const ids = csv(flags.ids);
      if (!ids?.length) throw new CliUsageError('Usage: tag set|add|remove --ids a,b --set x,y | --add x | --remove y [--note "..."]');
      const d = flags.diagram ? await ws.resolveDiagram(str(flags.diagram), str(flags.project)) : null;
      printJson(await ws.tagElements({
        elementIds: ids,
        tags: csv(flags.set),
        addTags: csv(flags.add),
        removeTags: csv(flags.remove),
        note: str(flags.note),
        ...(d ? { diagramId: d.id } : {})
      }));
      return;
    }
    case 'find': {
      if (!ref) throw new CliUsageError('Usage: tag find <tag> [--diagram ref]');
      const d = flags.diagram ? await ws.resolveDiagram(str(flags.diagram), str(flags.project)) : null;
      printJson(await ws.findByTag(ref, d?.id));
      return;
    }
    default:
      throw new CliUsageError('Usage: tag set|add|remove --ids a,b ... | tag find <tag>');
  }
}

export async function context(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv, { project: { takesValue: true } });
  await ensureCanvasRunning();
  const resolved = await ws.resolveProject(str(flags.project));
  process.stdout.write(await ws.getProjectContext(resolved.id) + '\n');
}
