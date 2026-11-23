// Walks docs/, keeps only .pdf files and writes files.json at the repo root.
// Zero dependencies. Usage: node scripts/build-index.mjs
import { readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');

// Keep in sync with `sections` in assets/config.js (ids and order).
const SECTIONS = ['nosos', 'yawmi', 'tanqit', 'mokhatatat'];

const collator = new Intl.Collator('ar', { numeric: true });

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

function lastCommitDate(relPath) {
  try {
    const out = execFileSync('git', ['-c', 'core.quotepath=false', 'log', '-1', '--format=%cI', '--', relPath], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

const sections = [];
for (const id of SECTIONS) {
  const secDir = path.join(docsDir, id);
  const byGroup = new Map();
  for (const full of await walk(secDir)) {
    const relToSection = path.relative(secDir, full).split(path.sep);
    const fileName = relToSection.pop();
    const group = relToSection.join(' / ');
    const rel = path.relative(root, full).split(path.sep).join('/');
    const st = await stat(full);
    const entry = {
      title: fileName.replace(/\.pdf$/i, '').replaceAll('_', ' '),
      path: rel,
      size: st.size,
      modified: lastCommitDate(rel) ?? st.mtime.toISOString(),
    };
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(entry);
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : collator.compare(a, b)))
    .map(([name, files]) => ({
      name,
      files: files.sort((x, y) => collator.compare(x.title, y.title)),
    }));
  sections.push({ id, groups });
}

const index = { generatedAt: new Date().toISOString(), sections };
await writeFile(path.join(root, 'files.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
const count = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.files.length, 0), 0);
console.log(`files.json written: ${count} PDF file(s)`);
