import fs from 'fs';
import os from 'os';
import path from 'path';
import { ValidationError } from './errors.js';

// A project can point at a folder on this machine (usually the repo the
// diagrams describe). Agents get read access to it; the UI can reveal it.

export function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

// Validate and canonicalise a folder path. null/'' unlinks.
export function normalizeRootPath(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError('Folder path must be a string');
  const expanded = expandHome(value.trim());
  if (!path.isAbsolute(expanded)) throw new ValidationError(`Folder path must be absolute: ${value}`);
  let real: string;
  try {
    real = fs.realpathSync(expanded);
  } catch {
    throw new ValidationError(`Folder not found: ${value}`);
  }
  if (!fs.statSync(real).isDirectory()) throw new ValidationError(`Not a folder: ${value}`);
  return real;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  remote: string | null;
}

// Read git metadata from the files, without spawning git.
export function gitInfo(root: string): GitInfo {
  const gitPath = path.join(root, '.git');
  let gitDir = gitPath;
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isFile()) {
      // worktree / submodule: "gitdir: <path>"
      const pointer = fs.readFileSync(gitPath, 'utf-8').match(/gitdir:\s*(.+)/)?.[1]?.trim();
      if (!pointer) return { isRepo: false, branch: null, remote: null };
      gitDir = path.resolve(root, pointer);
    }
  } catch {
    return { isRepo: false, branch: null, remote: null };
  }
  let branch: string | null = null;
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
    branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : head.slice(0, 12);
  } catch { /* detached or unreadable */ }
  let remote: string | null = null;
  const configCandidates = [path.join(gitDir, 'config'), path.join(gitDir, '..', '..', 'config')];
  for (const file of configCandidates) {
    try {
      const config = fs.readFileSync(file, 'utf-8');
      remote = config.match(/\[remote "origin"\][^[]*?url\s*=\s*(.+)/)?.[1]?.trim() ?? null;
      if (remote) break;
    } catch { /* keep looking */ }
  }
  // Strip credentials from https remotes before they reach a prompt or the UI.
  if (remote) remote = remote.replace(/\/\/[^/@]+@/, '//');
  return { isRepo: true, branch, remote };
}

export interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  home: string;
  isGitRepo: boolean;
  entries: DirEntry[];
  truncated: boolean;
}

const MAX_ENTRIES = 400;

export function listDirectories(input: string | undefined, showHidden = false): DirListing {
  const target = normalizeRootPath(input && input.trim() ? input : os.homedir())!;
  let names: fs.Dirent[] = [];
  try {
    names = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    throw new ValidationError(`Cannot read ${target}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`);
  }
  const dirs = names
    .filter(d => (d.isDirectory() || d.isSymbolicLink()) && (showHidden || !d.name.startsWith('.')) && d.name !== 'node_modules')
    .map(d => path.join(target, d.name))
    .filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } })
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { sensitivity: 'base' }));
  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    home: os.homedir(),
    isGitRepo: fs.existsSync(path.join(target, '.git')),
    entries: dirs.slice(0, MAX_ENTRIES).map(p => ({ name: path.basename(p), path: p, isGitRepo: fs.existsSync(path.join(p, '.git')) })),
    truncated: dirs.length > MAX_ENTRIES
  };
}

// Top-level names of a folder, for orienting an agent. Skips noise.
export function topLevelSummary(root: string, limit = 40): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules' && d.name !== 'dist')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, limit)
      .map(d => (d.isDirectory() ? `${d.name}/` : d.name));
  } catch {
    return [];
  }
}

export function displayPath(p: string): string {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? `~/${p.slice(home.length + 1)}` : p;
}
