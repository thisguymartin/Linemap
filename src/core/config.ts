import dotenv from 'dotenv';
import path from 'path';
import { packageRoot } from './paths.js';

// Load environment variables once for every entry point (MCP server, CLI, canvas server)
dotenv.config({ quiet: true });

// Express server configuration
export const EXPRESS_SERVER_URL = process.env.EXPRESS_SERVER_URL || 'http://127.0.0.1:3000';
export const ENABLE_CANVAS_SYNC = process.env.ENABLE_CANVAS_SYNC !== 'false'; // Default to true

// Opt-out for auto-starting the canvas server from the CLI / MCP server
export const EXCALIDRAW_NO_AUTOSTART = process.env.EXCALIDRAW_NO_AUTOSTART === '1';

// Safe file path validation base directory (see sanitizeFilePath)
export const ALLOWED_EXPORT_DIR = process.env.EXCALIDRAW_EXPORT_DIR || process.cwd();

// Local database, run logs and exports. A custom directory is also the source
// for a one-time legacy JSON import; the default imports the old repo data/.
export const DATA_DIR = process.env.EXCALIDRAW_DATA_DIR
  ? path.resolve(process.env.EXCALIDRAW_DATA_DIR)
  : path.join(packageRoot(), '.local');
export const LEGACY_DATA_DIR = process.env.EXCALIDRAW_DATA_DIR
  ? DATA_DIR
  : path.join(packageRoot(), 'data');
