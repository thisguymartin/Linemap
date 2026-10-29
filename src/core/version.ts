import fs from 'fs';
import path from 'path';
import { packageRoot } from './paths.js';

// Single source of truth for the package version (MCP server metadata,
// CLI --version): read package.json so it can never drift from npm again.
export function packageVersion(): string {
  try {
    const pkgPath = path.join(packageRoot(), 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}
