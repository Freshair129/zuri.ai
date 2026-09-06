import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { loadCostCatalog } from './cost-catalog.js';
import { createPricingRouter, roleForKey } from './service.js';

/**
 * The socket around the router.
 *
 * It does three things and nothing else: read the body, decide the caller's role from one header,
 * and hand both to the router. Every pricing rule lives in the engine; nothing here may compute a
 * number, which is what keeps this from becoming a second implementation of the price list.
 */

export const ROLE_HEADER = 'x-zuri-pricing-key';
export const DEFAULT_PRICING_PORT = 8899;

export interface PricingServerOptions {
  catalogRoot: string;
  ownerKey: string | null;
  port?: number;
  /**
   * Loopback by default. Reaching this service from another machine is Tailscale's job
   * (`tailscale serve`), not an open bind — the payload carries factory costs.
   */
  host?: string;
  now?: () => Date;
  log?: (line: string) => void;
  /**
   * Where the calculator's own files live. Serving the page from the same origin as the API is
   * what lets it stop carrying a second copy of the pricing rules: no CORS to open, and no owner
   * key baked into a page that someone else hosts.
   */
  publicDir?: string;
}

export interface PricingServer {
  port: number;
  close: () => Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Resolve a URL path inside one root, or refuse.
 *
 * The check is on the *resolved* path rather than on the text of the request, because `..`, its
 * percent-encoded spellings and a symlinked segment all look different as text and identical once
 * resolved. Anything that lands outside the root is a miss, not a file.
 */
function resolveWithin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\u0000')) return null;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, '.' + (decoded.startsWith('/') ? decoded : `/${decoded}`));
  const withinRoot = candidate === resolvedRoot || candidate.startsWith(resolvedRoot + path.sep);
  return withinRoot ? candidate : null;
}

function serveFile(res: http.ServerResponse, filePath: string): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function readBody(req: http.IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false };
  }
}

export async function startPricingServer(options: PricingServerOptions): Promise<PricingServer> {
  const catalog = loadCostCatalog(options.catalogRoot);
  const router = createPricingRouter({ catalog, ownerKey: options.ownerKey, now: options.now });
  const log = options.log ?? (() => {});

  const server = http.createServer((req, res) => {
    void (async () => {
      const presented = req.headers[ROLE_HEADER];
      const role = roleForKey(Array.isArray(presented) ? presented[0] : presented, options.ownerKey);
      const send = (status: number, body: unknown) => {
        const payload = JSON.stringify(body);
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(payload);
      };

      try {
        const pathname = (req.url || '/').split('?')[0];

        // Static first: the calculator page and its thumbnails. Both roots are resolved and
        // range-checked, so a request can only ever name a file inside them.
        if (req.method === 'GET' && options.publicDir) {
          const rel = pathname === '/' ? '/pricing.html' : pathname;
          if (!rel.startsWith('/api/') && rel !== '/health') {
            const filePath = resolveWithin(options.publicDir, rel);
            if (filePath && serveFile(res, filePath)) {
              log(`GET ${pathname} role=${role} -> 200 static`);
              return;
            }
          }
        }
        if (req.method === 'GET' && pathname.startsWith('/catalog/img/')) {
          const filePath = resolveWithin(
            path.join(options.catalogRoot, 'img'),
            pathname.slice('/catalog/img'.length)
          );
          if (filePath && serveFile(res, filePath)) {
            log(`GET ${pathname} role=${role} -> 200 image`);
            return;
          }
          send(404, { error: 'ไม่พบไฟล์รูป' });
          return;
        }

        const body = await readBody(req);
        if (!body.ok) {
          send(400, { error: 'เนื้อหาคำขอไม่ใช่ JSON ที่อ่านได้' });
          return;
        }
        const result = await router.handle(req.method || 'GET', req.url || '/', body.value, role);
        // The role is logged, the key never is.
        log(`${req.method} ${req.url} role=${role} -> ${result.status}`);
        send(result.status, result.body);
      } catch (err) {
        log(`${req.method} ${req.url} role=${role} -> 500 ${err instanceof Error ? err.message : String(err)}`);
        send(500, { error: 'เกิดข้อผิดพลาดภายในบริการราคา' });
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port ?? DEFAULT_PRICING_PORT, options.host ?? '127.0.0.1', resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
