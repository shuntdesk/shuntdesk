// Local server: serves site/ and runs server/worker.js behind /api/, with a JSON file standing in
// for Cloudflare KV and a timer standing in for the cron trigger.  node dev/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../server/worker.js';

const here = fileURLToPath(new URL('.', import.meta.url)), root = join(here, '..', 'site'), dataDir = join(here, '..', '.data');
const port = Number(process.argv[2]) || 8791;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// keys for the backend come from .env.local (never committed); the conductor works without one
const env = { KV: { async get(k) { try { return await readFile(join(dataDir, k + '.json'), 'utf8'); } catch (e) { return null; } }, async put(k, v) { await mkdir(dataDir, { recursive: true }); await writeFile(join(dataDir, k + '.json'), v); } } };
const envFile = join(here, '..', '.env.local');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let file = join(root, p);
    if (!file.startsWith(root)) throw new Error('outside root');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log('http://localhost:' + port + (env.OPENROUTER_API_KEY || env.GROQ_API_KEY ? '  (conductor: model)' : '  (conductor: rules only, no OPENROUTER_API_KEY or GROQ_API_KEY in .env.local)')));

// the cron trigger: mark the crew desk once a minute
const run = () => worker.scheduled({}, env).catch(e => console.log('tick failed:', e.message));
setTimeout(run, 3000); setInterval(run, 60000);
