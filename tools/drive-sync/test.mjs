// Runs Code.gs in Node against a fake Drive and a fake GitHub. Usage: node tools/drive-sync/test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const code = readFileSync(path.join(here, 'Code.gs'), 'utf8');

const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b)); // Apps Script bytes are signed
const unsigned = (arr) => Buffer.from(arr.map((b) => (b + 256) % 256));
const gitSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// ---- fake Drive ----
let clock = 1000;
const mkFile = (name, content, opts = {}) => ({
  name, buf: Buffer.from(content), id: 'id' + ++clock, updated: ++clock, trashed: false, size: opts.size,
  getName() { return this.name; }, getId() { return this.id; }, isTrashed() { return this.trashed; },
  getLastUpdated() { return new Date(this.updated); }, getSize() { return this.size ?? this.buf.length; },
  getBlob() { downloads++; return { getBytes: () => signed(this.buf) }; },
});
const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };
const mkFolder = (name) => ({
  name, files: [], folders: [], trashed: false,
  getName() { return this.name; }, isTrashed() { return this.trashed; },
  getFilesByType() { return iter(this.files); }, getFolders() { return iter(this.folders); },
});
const drive = { NOSOS: mkFolder('nosos'), YAWMI: mkFolder('yawmi'), TANQIT: mkFolder('tanqit'), MOKH: mkFolder('mokhatatat') };
let downloads = 0;

// ---- fake GitHub (one branch, flat path -> blob sha) ----
const gh = { blobs: new Map(), trees: new Map(), commits: new Map(), head: null, calls: [] };
const putTree = (files) => { const sha = 't' + gh.trees.size; gh.trees.set(sha, new Map(files)); return sha; };
const putCommit = (tree, parents, message) => { const sha = 'c' + gh.commits.size; gh.commits.set(sha, { tree, parents, message }); return sha; };
const repoFiles = () => gh.trees.get(gh.commits.get(gh.head).tree);
const respond = (status, body) => ({ getResponseCode: () => status, getContentText: () => JSON.stringify(body) });
function fetchFake(url, options) {
  const p = url.replace('https://api.github.com/repos/o/r', '');
  const method = options.method;
  gh.calls.push(method + ' ' + p);
  assert.equal(options.headers.Authorization, 'Bearer T');
  const body = options.payload ? JSON.parse(options.payload) : null;
  let m;
  if (method === 'get' && p === '/git/ref/heads/main') return respond(200, { object: { sha: gh.head } });
  if (method === 'get' && (m = p.match(/^\/git\/commits\/(\w+)$/))) return respond(200, { tree: { sha: gh.commits.get(m[1]).tree } });
  if (method === 'get' && (m = p.match(/^\/git\/trees\/(\w+)\?recursive=1$/)))
    return respond(200, { truncated: false, tree: [...gh.trees.get(m[1])].map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' })) });
  if (method === 'post' && p === '/git/blobs') {
    const buf = Buffer.from(body.content, 'base64');
    const sha = gitSha(buf);
    gh.blobs.set(sha, buf);
    return respond(201, { sha });
  }
  if (method === 'post' && p === '/git/trees') {
    const files = new Map(gh.trees.get(body.base_tree));
    for (const e of body.tree) e.sha === null ? files.delete(e.path) : files.set(e.path, e.sha);
    return respond(201, { sha: putTree(files) });
  }
  if (method === 'post' && p === '/git/commits') return respond(201, { sha: putCommit(body.tree, body.parents, body.message) });
  if (method === 'patch' && p === '/git/refs/heads/main') {
    assert.deepEqual(gh.commits.get(body.sha).parents, [gh.head], 'fast-forward only');
    gh.head = body.sha;
    return respond(200, {});
  }
  return respond(404, { message: 'unexpected ' + method + ' ' + p });
}

// ---- Apps Script globals ----
const store = { GITHUB_TOKEN: 'T' };
const sandbox = {
  console: { log() {} },
  MimeType: { PDF: 'application/pdf' },
  DriveApp: { getFolderById: (id) => drive[id] ?? (() => { throw new Error('no folder ' + id); })() },
  UrlFetchApp: { fetch: fetchFake },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { throw new Error('not used in tests'); } },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (k) => store[k] ?? null,
      getProperties: () => ({ ...store }),
      setProperties: (o) => Object.assign(store, o),
      deleteProperty: (k) => { delete store[k]; },
    }),
  },
  Utilities: {
    DigestAlgorithm: { SHA_1: 'sha1' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, value) => signed(createHash(alg).update(typeof value === 'string' ? Buffer.from(value, 'utf8') : unsigned(value)).digest()),
    base64Encode: (bytes) => unsigned(bytes).toString('base64'),
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'Code.gs' });
vm.runInContext(
  "CONFIG.owner = 'o'; CONFIG.repo = 'r'; CONFIG.sections = { nosos: 'NOSOS', yawmi: 'YAWMI', tanqit: 'TANQIT', mokhatatat: 'MOKH' };",
  sandbox,
);
const call = (expr) => vm.runInContext(expr, sandbox);
const sync = () => { gh.calls.length = 0; downloads = 0; return call('syncDriveToGitHub()'); };
const writes = () => gh.calls.filter((c) => !c.startsWith('get '));

// 1. gitBlobSha_ matches git itself, on the real published PDFs.
let checked = 0;
for (const dir of ['docs/nosos', 'docs/yawmi']) {
  for (const name of readdirSync(path.join(root, dir)).filter((n) => n.toLowerCase().endsWith('.pdf'))) {
    const full = path.join(root, dir, name);
    const expected = execFileSync('git', ['hash-object', full], { encoding: 'utf8' }).trim();
    sandbox.__bytes = signed(readFileSync(full));
    assert.equal(call('gitBlobSha_(__bytes)'), expected, name);
    checked++;
  }
}
console.log(`ok  gitBlobSha_ equals git hash-object on ${checked} real PDF file(s)`);

// 2. cleanName_
assert.equal(call('cleanName_("التقويم 1.PDF", true)'), 'التقويم 1.pdf');
assert.equal(call('cleanName_("a/b:c?.pdf", true)'), 'a-b-c-.pdf');
assert.equal(call('cleanName_("بلا امتداد", true)'), 'بلا امتداد.pdf');
assert.equal(call('cleanName_("  1م1 . ", false)'), '1م1');
assert.equal(call('cleanName_("..", false)'), 'بدون اسم');
console.log('ok  cleanName_');

// 3. First run: Drive already holds exactly what the site has -> no commit, other repo files untouched.
const a = mkFile('دفتر النصوص 1م1.pdf', 'AAA');
const b = mkFile('الكراس اليومي.pdf', 'BBB');
drive.NOSOS.files.push(a);
drive.YAWMI.files.push(b);
gh.head = putCommit(putTree([
  ['index.html', 'x1'], ['docs/nosos/.gitkeep', 'x2'], ['README.pdf', 'x3'],
  ['docs/nosos/دفتر النصوص 1م1.pdf', gitSha(a.buf)], ['docs/yawmi/الكراس اليومي.pdf', gitSha(b.buf)],
]), [], 'init');
sync();
assert.deepEqual(writes(), [], 'identical content must not write');
assert.equal(downloads, 2);
console.log('ok  identical Drive and site: nothing written');

// 4. Second run with nothing changed: no download at all.
sync();
assert.deepEqual(writes(), []);
assert.equal(downloads, 0);
console.log('ok  unchanged since last run: no download');

// 5. Add in a class sub-folder, update one file, ignore a trashed one.
const sub = mkFolder('1م1');
const c = mkFile('التقويم الأول.pdf', 'CCC');
const gone = mkFile('محذوف.pdf', 'ZZZ');
gone.trashed = true;
sub.files.push(c);
drive.TANQIT.folders.push(sub);
drive.TANQIT.files.push(gone);
a.buf = Buffer.from('AAA v2');
a.updated = ++clock;
const before = gh.head;
sync();
assert.equal(writes().filter((w) => w === 'post /git/blobs').length, 2);
assert.equal(writes().filter((w) => w === 'post /git/commits').length, 1, 'one commit for all changes');
assert.equal(gh.commits.get(gh.head).message, 'Drive sync: 1 added, 1 updated, 0 removed');
assert.deepEqual(gh.commits.get(gh.head).parents, [before]);
assert.equal(repoFiles().get('docs/tanqit/1م1/التقويم الأول.pdf'), gitSha(c.buf));
assert.equal(repoFiles().get('docs/nosos/دفتر النصوص 1م1.pdf'), gitSha(a.buf));
assert.equal(repoFiles().has('docs/tanqit/محذوف.pdf'), false);
assert.equal(repoFiles().get('index.html'), 'x1');
assert.equal(repoFiles().get('README.pdf'), 'x3', 'PDFs outside docs/<section>/ are not touched');
console.log('ok  add + update in one commit');

// 6. Removing from Drive removes from the site; .gitkeep and other files stay.
drive.YAWMI.files.length = 0;
sync();
assert.equal(gh.commits.get(gh.head).message, 'Drive sync: 0 added, 0 updated, 1 removed');
assert.equal(repoFiles().has('docs/yawmi/الكراس اليومي.pdf'), false);
assert.equal(repoFiles().get('docs/nosos/.gitkeep'), 'x2');
console.log('ok  removal');

// 7. Someone changed a mirrored file in the repository by hand: Drive wins again.
const hand = new Map(repoFiles());
hand.set('docs/nosos/دفتر النصوص 1م1.pdf', 'manual');
gh.head = putCommit(putTree(hand), [gh.head], 'manual edit');
sync();
assert.equal(repoFiles().get('docs/nosos/دفتر النصوص 1م1.pdf'), gitSha(a.buf));
console.log('ok  manual change in the repository is overwritten by Drive');

// 8. Same name twice in one folder: the most recent wins. Too-large files are left alone.
const dup = mkFile('دفتر النصوص 1م1.pdf', 'NEWER');
drive.NOSOS.files.unshift(dup);
const big = mkFile('كبير.pdf', 'x', { size: 31 * 1024 * 1024 });
drive.MOKH.files.push(big);
sync();
assert.equal(repoFiles().get('docs/nosos/دفتر النصوص 1م1.pdf'), gitSha(dup.buf));
assert.equal(repoFiles().has('docs/mokhatatat/كبير.pdf'), false);
console.log('ok  duplicate names and too-large files');

// 9. Empty Drive listing never wipes the site.
const saved = [drive.NOSOS.files, drive.TANQIT.folders, drive.MOKH.files];
drive.NOSOS.files = []; drive.TANQIT.folders = []; drive.MOKH.files = [];
const count = repoFiles().size;
const msg = sync();
assert.deepEqual(writes(), []);
assert.equal(repoFiles().size, count);
assert.match(msg, /nothing was removed/);
[drive.NOSOS.files, drive.TANQIT.folders, drive.MOKH.files] = saved;
console.log('ok  empty Drive: nothing removed');

// 10. A trashed section folder or a missing token stops the run before any write.
drive.YAWMI.trashed = true;
assert.throws(sync, /in the trash/);
assert.deepEqual(writes(), []);
drive.YAWMI.trashed = false;
delete store.GITHUB_TOKEN;
assert.throws(sync, /GITHUB_TOKEN is missing/);
store.GITHUB_TOKEN = 'T';
console.log('ok  trashed folder / missing token abort cleanly');

// 11. State only keeps entries of files that still exist.
sync();
const keys = Object.keys(store).filter((k) => k.startsWith('f:'));
assert.equal(keys.length, [...repoFiles().keys()].filter((p) => /^docs\/(nosos|yawmi|tanqit|mokhatatat)\/.*\.pdf$/.test(p)).length);
console.log('ok  state has one entry per mirrored file');
console.log('\nall tests passed');
