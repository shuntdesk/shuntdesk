// syntax check of every script in the repo, with no dependency: node parses each one and exits on the first error
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const skip = new Set(['node_modules', '.wrangler', '.data', 'vendor', '.git']);
const files = [];
(function walk(d) { for (const n of readdirSync(d)) { if (skip.has(n)) continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.m?js$/.test(n) && files.push(p); } })('.');
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax ok: ${files.length} files`);