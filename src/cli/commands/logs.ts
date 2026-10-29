import fs from 'fs';
import { parseArgs, CliUsageError } from '../args.js';
import { RESOLVED_LOG_FILE_PATH } from '../../utils/logger.js';

// Print (and optionally follow) the canvas server's log. Agent runs log one
// line when they start and one when they finish or fail; each run's raw CLI
// output is in data/projects/<project>/runs/<message>.log ("View log" in Chat).
export async function logs(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv, {
    lines: { takesValue: true }, n: { takesValue: true }, follow: { takesValue: false }, f: { takesValue: false },
    path: { takesValue: false }, agent: { takesValue: false }
  });
  const file = RESOLVED_LOG_FILE_PATH;
  if (flags.path) {
    process.stdout.write(file + '\n');
    return;
  }
  const count = Number(flags.lines ?? flags.n ?? 80);
  if (!Number.isFinite(count) || count < 1) throw new CliUsageError('--lines must be a positive number');
  const agentOnly = !!flags.agent;
  const keep = (line: string): boolean => !agentOnly || /agent/i.test(line);

  let position = 0;
  try {
    const text = fs.readFileSync(file, 'utf-8');
    position = Buffer.byteLength(text);
    const lines = text.split('\n').filter(l => l && keep(l));
    process.stderr.write(`# ${file}\n`);
    process.stdout.write(lines.slice(-count).join('\n') + (lines.length ? '\n' : ''));
  } catch {
    process.stderr.write(`# ${file} (empty so far)\n`);
  }
  if (!(flags.follow || flags.f)) return;

  process.stderr.write('# following (Ctrl-C to stop)\n');
  let partial = '';
  await new Promise<never>(() => {
    fs.watchFile(file, { interval: 400 }, stat => {
      if (stat.size < position) position = 0; // rotated or truncated
      if (stat.size === position) return;
      const stream = fs.createReadStream(file, { start: position, end: stat.size - 1, encoding: 'utf-8' });
      position = stat.size;
      stream.on('data', chunk => {
        const text = partial + String(chunk);
        const parts = text.split('\n');
        partial = parts.pop() ?? '';
        const out = parts.filter(l => l && keep(l));
        if (out.length) process.stdout.write(out.join('\n') + '\n');
      });
    });
  });
}
