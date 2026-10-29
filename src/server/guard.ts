import type { NextFunction, Request, Response } from 'express';

// The canvas server can spawn coding agents with read access to your repos,
// so it must not answer other websites. Browsers always send Origin on
// cross-site requests; Host catches DNS rebinding (a foreign name that
// resolves to 127.0.0.1). Clients without Origin (CLI, MCP server, curl)
// pass, as before.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1).toLowerCase();
  return hostHeader.split(':')[0]!.toLowerCase();
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.replace(/^\[|\]$/g, '') === '::1' ? '::1' : host);
}

export function requestGuard(options: { loopbackBind: boolean }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = req.headers.host;
    if (options.loopbackBind && !LOOPBACK.has(hostnameOf(host))) {
      res.status(403).json({ success: false, error: 'Forbidden host' });
      return;
    }
    // "null" is what sandboxed iframes and file:// pages send: foreign.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      let originHostname = '';
      try {
        const url = new URL(origin);
        originHost = url.host.toLowerCase();
        originHostname = url.hostname.toLowerCase();
      } catch { /* malformed: rejected below */ }
      const sameHost = originHost !== '' && originHost === (host ?? '').toLowerCase();
      if (!sameHost && !LOOPBACK.has(originHostname)) {
        res.status(403).json({ success: false, error: 'Cross-origin requests are not allowed' });
        return;
      }
    }
    next();
  };
}
