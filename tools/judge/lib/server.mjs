// Minimal static server for the site root, with Netlify-style pretty URLs (/about/ -> about/index.html).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

export function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let path = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!path.startsWith(root + sep) && path !== root) throw Object.assign(new Error('forbidden'), { code: 403 });
      // Never serve tooling (Netlify publishes the repo root, but the judge shouldn't depend on it).
      if (path.startsWith(join(root, 'tools') + sep)) throw Object.assign(new Error('not found'), { code: 404 });
      let s = await stat(path).catch(() => null);
      if (s?.isDirectory()) { path = join(path, 'index.html'); s = await stat(path).catch(() => null); }
      if (!s) throw Object.assign(new Error('not found'), { code: 404 });
      res.writeHead(req.method === 'POST' ? 405 : 200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(path));
    } catch (e) {
      res.writeHead(e.code === 403 ? 403 : 404, { 'content-type': 'text/plain' });
      res.end(e.message);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
  }));
}
