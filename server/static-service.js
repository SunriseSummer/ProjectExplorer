import fsp from 'node:fs/promises';
import path from 'node:path';
import { MIME_TYPES } from './constants.js';

export async function serveStatic(publicDir, url, res) {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const target = path.resolve(publicDir, `.${path.normalize(pathname)}`);
  if (target !== publicDir && !target.startsWith(publicDir + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }

  try {
    const buffer = await fsp.readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(buffer);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}
