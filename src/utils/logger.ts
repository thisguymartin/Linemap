import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';
import { homedir, tmpdir } from 'os';

/**
 * Choose a platform-compatible default log path. MCP servers are launched in
 * the caller's working directory, so a relative path would scatter log files
 * across unrelated project and cloud-synced folders.
 *
 * LOG_FILE_PATH can still override this default.
 */
function defaultLogPath(): string {
  if (process.platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Logs', 'linemap.log');
  }
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local');
    return path.join(base, 'Linemap', 'linemap.log');
  }
  // Linux and other POSIX platforms: follow the XDG state convention.
  const xdgState = process.env.XDG_STATE_HOME || path.join(homedir(), '.local', 'state');
  return path.join(xdgState, 'linemap', 'linemap.log');
}

const LOG_FILE_PATH = process.env.LOG_FILE_PATH || defaultLogPath();

function ensureWritableLogFile(filePath: string): string {
  const logDir = path.dirname(filePath);
  fs.mkdirSync(logDir, { recursive: true });
  fs.accessSync(logDir, fs.constants.W_OK);
  return filePath;
}

function resolveLogFilePath(): string {
  try {
    return ensureWritableLogFile(LOG_FILE_PATH);
  } catch (error) {
    if (process.env.LOG_FILE_PATH) {
      throw error;
    }
  }

  return ensureWritableLogFile(path.join(tmpdir(), 'linemap.log'));
}

export const RESOLVED_LOG_FILE_PATH = resolveLogFilePath();

const logger: winston.Logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',

  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.uncolorize(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    winston.format.printf(info => {
      const extra = info.metadata && Object.keys(info.metadata).length
        ? ` ${JSON.stringify(info.metadata)}`
        : '';
      return `${info.timestamp} [${info.level}] ${info.message}${extra}`
    })
  ),

  transports: [
    // Always stderr: in MCP stdio mode stdout belongs to JSON-RPC. The
    // console shows warn+ by default; `linemap up` raises it via
    // LOG_CONSOLE_LEVEL so the terminal shows the server working.
    new winston.transports.Console({
      level: process.env.LOG_CONSOLE_LEVEL || 'warn',
      stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
      format: winston.format.printf(info => {
        const meta = (info.metadata ?? {}) as Record<string, unknown>;
        const short = Object.entries(meta)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${k}=${typeof v === 'string' ? (v.length > 60 ? `…${v.slice(-57)}` : v) : JSON.stringify(v)}`)
          .join(' ');
        const time = String(info.timestamp).slice(11, 19);
        const level = info.level === 'info' ? '' : ` ${info.level.toUpperCase()}`;
        return `${time}${level} ${info.message}${short ? `  ${short}` : ''}`;
      })
    }),

    new winston.transports.File({
      filename: RESOLVED_LOG_FILE_PATH,    // all levels to file
      level: 'debug'
    })
  ]
});

export default logger;
