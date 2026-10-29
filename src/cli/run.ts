import { CliUsageError } from './args.js';
import { packageVersion } from '../core/version.js';
import * as server from './commands/server.js';
import * as elements from './commands/elements.js';
import * as scene from './commands/scene.js';
import { snapshot } from './commands/snapshot.js';
import { arrange } from './commands/arrange.js';
import { installSkill } from './commands/install-skill.js';
import { render } from './commands/render.js';
import * as workspace from './commands/workspace.js';
import { logs } from './commands/logs.js';
import { IMAGE_FLAG_USAGE } from './image-options.js';
import { cliName } from './util.js';

interface Command {
  handler: (argv: string[]) => Promise<void>;
  summary: string;
  usage: string;
}

const COMMANDS: Record<string, Command> = {
  up: { handler: server.up, summary: 'Run the canvas in this terminal with its log (Ctrl-C stops)', usage: 'up [--open] [--quiet|--verbose] [--bun|--node] [--port 3100]' },
  start: { handler: server.start, summary: 'Start the canvas server in the background (detached)', usage: 'start' },
  stop: { handler: server.stop, summary: 'Stop the canvas server', usage: 'stop' },
  status: { handler: server.status, summary: 'Canvas health, element count, renderers, browser clients', usage: 'status' },
  apply: { handler: elements.apply, summary: 'Apply a {create,update,delete} patch in one call', usage: 'apply [patch.json|-] (update entries accept direct fields or {id,set:{...}})' },
  add: { handler: elements.add, summary: 'Create elements from a JSON array', usage: 'add [elements.json] (or stdin) | add --one \'{"type":"rectangle",...}\'' },
  update: { handler: elements.update, summary: 'Update one element', usage: 'update <id> --set \'{"backgroundColor":"#ffc9c9"}\'' },
  delete: { handler: elements.del, summary: 'Delete elements by id', usage: 'delete <id> [<id> ...]' },
  get: { handler: elements.get, summary: 'Get one element by id', usage: 'get <id>' },
  query: { handler: elements.query, summary: 'Query elements (server + typed client-side filters)', usage: 'query [--type rectangle] [--bbox x0,y0,x1,y1] [--filter locked=true] [--filter-json \'{...}\']' },
  describe: { handler: scene.describe, summary: 'AI-readable scene description (plain text)', usage: 'describe' },
  screenshot: { handler: scene.screenshot, summary: 'Render the canvas to PNG/SVG (headless; no browser tab needed)', usage: `screenshot [--out file.png|file.svg] [--renderer auto|node|browser] ${IMAGE_FLAG_USAGE}` },
  render: { handler: render, summary: 'Render a .excalidraw / .excalidraw.md file to PNG/SVG offline (no canvas server)', usage: `render [scene.excalidraw|note.excalidraw.md|-] [--out file.png|file.svg] ${IMAGE_FLAG_USAGE}` },
  export: { handler: scene.exportCmd, summary: 'Export the scene as .excalidraw JSON or Obsidian .excalidraw.md', usage: 'export [--out scene.excalidraw | note.excalidraw.md] [--format json|obsidian] (a .md out path implies obsidian)' },
  import: { handler: scene.importCmd, summary: 'Import a .excalidraw or Obsidian .excalidraw.md file (merge by default)', usage: 'import [scene.excalidraw|note.excalidraw.md|-] [--replace] (or stdin)' },
  mermaid: { handler: scene.mermaid, summary: 'Render a Mermaid diagram onto the canvas (needs a browser tab)', usage: 'mermaid [diagram.mmd|-] (or stdin)' },
  snapshot: { handler: snapshot, summary: 'Save / list / restore named canvas snapshots', usage: 'snapshot save|list|restore [name]' },
  arrange: { handler: arrange, summary: 'Align, distribute, group, lock, duplicate elements', usage: 'arrange align|distribute|group|ungroup|lock|unlock|duplicate --ids a,b,c [--to left|horizontal|...]' },
  share: { handler: scene.share, summary: 'Export to a shareable excalidraw.com URL', usage: 'share' },
  clear: { handler: scene.clear, summary: 'Clear the whole canvas', usage: 'clear --yes' },
  'install-skill': { handler: installSkill, summary: 'Install the bundled agent skill', usage: 'install-skill [--dir <skills-root>] [--target claude|codex|<skills-root>] [--print-source]' },
  project: { handler: workspace.project, summary: 'List / create / show / update / link a folder / delete projects', usage: 'project list|create <name> [--folder path]|show <ref>|update <ref>|link [ref] <folder>|unlink [ref]|delete <ref> --yes [--description ...] [--tags a,b]' },
  diagram: { handler: workspace.diagram, summary: 'List / create / open / show / update / delete diagrams', usage: 'diagram list|create <name>|open <ref>|show <ref>|active|update <ref>|delete <ref> --yes [--project ref] [--no-open]' },
  version: { handler: workspace.version, summary: 'Save / confirm / restore / delete numbered versions', usage: 'version list|save [label]|confirm <v>|restore <v>|show <v>|delete <v> [--diagram ref] [--note ...] [--confirm]' },
  note: { handler: workspace.notes, summary: 'Conversation notes anchored to diagrams and elements', usage: 'note list|add "text"|resolve <id>|reopen <id>|delete <id> [--diagram ref] [--elements a,b] [--tags x] [--agent] [--all]' },
  link: { handler: workspace.link, summary: 'Link diagrams (and shapes) together', usage: 'link list|add --to <diagram> [--from <diagram>] [--from-element id] [--relation r]|delete <id>' },
  tag: { handler: workspace.tag, summary: 'Tag elements, find elements by tag', usage: 'tag set|add|remove --ids a,b [--set x,y|--add x|--remove y] [--note ...] | tag find <tag>' },
  logs: { handler: logs, summary: 'Show or follow the canvas server log (agent runs, errors)', usage: 'logs [-f] [--lines 80] [--agent] [--path]' },
  context: { handler: workspace.context, summary: 'Print the project brain (markdown digest) for an agent', usage: 'context [--project ref]' }
};

function printHelp(): void {
  const cli = cliName();
  const lines = [
    `Linemap ${packageVersion()}: an Excalidraw workbench you and your coding agents share`,
    '',
    'Usage:',
    `  ${cli}                  Run the MCP stdio server (for MCP clients)`,
    `  ${cli} <command> [...]  Drive the canvas and workspace from the command line`,
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, cmd]) => `  ${name.padEnd(14)} ${cmd.summary}`),
    '',
    'Conventions:',
    '  Results are JSON on stdout — except `describe` (plain text) and raw-content',
    '  output when --out is omitted (`export` scene JSON, `screenshot --format svg`).',
    '  Diagnostics go to stderr.',
    '  Exit codes: 0 ok, 1 error, 2 usage, 3 canvas unreachable, 4 browser tab required (mermaid, --renderer browser).',
    '  Canvas-driving commands auto-start the server (disable with EXCALIDRAW_NO_AUTOSTART=1).',
    '  Canvas URL comes from EXPRESS_SERVER_URL (default http://127.0.0.1:3000) or --url.',
    '',
    `Run \`${cli} help <command>\` for per-command usage.`
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function exitCodeFor(error: unknown): number {
  if (error instanceof CliUsageError) return 2;
  const code = (error as any)?.code;
  if (code === 'CANVAS_UNREACHABLE') return 3;
  if (code === 'BROWSER_REQUIRED') return 4;
  return 1;
}

export async function runCli(argv: string[]): Promise<void> {
  const [name, ...rest] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    const topic = name === 'help' ? rest[0] : undefined;
    if (topic && COMMANDS[topic]) {
      process.stdout.write(`Usage: ${cliName()} ${COMMANDS[topic].usage}\n  ${COMMANDS[topic].summary}\n`);
    } else {
      printHelp();
    }
    return;
  }

  if (name === '--version' || name === '-v') {
    process.stdout.write(packageVersion() + '\n');
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`Unknown command "${name}". Run \`${cliName()} help\` for the list.\n`);
    process.exitCode = 2;
    return;
  }

  try {
    await command.handler(rest);
  } catch (error) {
    if (!(error as any)?.quiet) {
      process.stderr.write(`Error: ${(error as Error).message}\n`);
    }
    if (error instanceof CliUsageError) {
      process.stderr.write(`Usage: ${cliName()} ${command.usage}\n`);
    }
    process.exitCode = exitCodeFor(error);
  }
}
