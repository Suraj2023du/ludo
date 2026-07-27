/**
 * tools/serve.js — zero-dependency static server for local testing.
 *
 *   npm run serve            → http://localhost:8080
 *   npm run serve -- 5173    → custom port
 *
 * A service worker needs a real http:// origin, so use this (or any static
 * server) instead of opening index.html from the filesystem.
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // keep requests inside the project
  const target = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let stat;
  try {
    stat = statSync(target);
    if (stat.isDirectory()) throw new Error('directory');
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 ' + rel);
    return;
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
    'Service-Worker-Allowed': '/',
  });
  createReadStream(target).pipe(res);
});

server.listen(PORT, () => {
  console.log('Ludo Battle → http://localhost:' + PORT);
  console.log('(Ctrl+C to stop)');
});
