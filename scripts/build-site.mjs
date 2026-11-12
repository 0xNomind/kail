// Puts what a browser needs, and nothing else, into dist/: the pages, their scripts and styles, the pictures and
// the packed libraries. That folder is what gets published (server/wrangler.toml). The game has no build step
// beyond this copy: the files are served as they are written.
//
//   node scripts/build-site.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'dist');
const PAGES = ['index.html', 'play.html', 'harbour.html', 'tickets.html', 'week.html', 'favicon.ico'], FOLDERS = ['src', 'public'];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
let files = 0, bytes = 0;
function copy(from, to) {
  const s = fs.statSync(from);
  if (s.isDirectory()) { fs.mkdirSync(to, { recursive: true }); for (const name of fs.readdirSync(from)) if (!name.startsWith('.')) copy(path.join(from, name), path.join(to, name)); }
  else { fs.copyFileSync(from, to); files += 1; bytes += s.size; }
}
for (const p of PAGES) copy(path.join(root, p), path.join(out, p));
for (const f of FOLDERS) copy(path.join(root, f), path.join(out, f));
console.log(`dist/: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
