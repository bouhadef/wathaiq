/**
 * Mirrors the PDF files of four Google Drive folders into the GitHub repository
 * behind https://bouhadef.github.io/wathaiq/ : Drive is the source, the site follows.
 * One commit per run, and only when something changed.
 *
 * Setup (once):
 *   1. Project Settings > Script properties: GITHUB_TOKEN = a fine-grained GitHub token
 *      limited to the repository below, with "Contents: Read and write".
 *   2. Run `install` and approve the permissions. It syncs now, then every 15 minutes.
 *
 * The copy kept in the repository (tools/drive-sync/Code.gs) is the reference.
 */
const CONFIG = {
  owner: 'bouhadef',
  repo: 'wathaiq',
  branch: 'main',
  // Site section (docs/<section>/ in the repository) -> Drive folder id.
  sections: {
    nosos: '1EQavHuzpXc0RKjPUpy_E76N6iNrIR0hv', // دفاتر النصوص
    yawmi: '1KtQc9FFxJLxkwruqIeFoDUzb2atLE945', // الكراس اليومي
    tanqit: '1aNvhqU_VolpWe7e6gHklfD17sDNw8GiW', // دفتر التنقيط
    mokhatatat: '1--v9e8ySuGqMF4ua5LjA7l7edWGRZui1', // المخططات السنوية
  },
  // Sections whose files are added under their exact name. In the other sections a file is
  // updated by name: a browser's download suffix ("name (1).pdf") is dropped, so a file that
  // was downloaded again replaces its older version instead of appearing beside it.
  exactNameSections: ['tanqit'],
  everyMinutes: 15, // Apps Script accepts 1, 5, 10, 15 or 30
  maxFileBytes: 30 * 1024 * 1024,
};

/** Run once by hand: (re)creates the timer and syncs immediately. */
function install() {
  uninstall();
  ScriptApp.newTrigger('syncDriveToGitHub').timeBased().everyMinutes(CONFIG.everyMinutes).create();
  return syncDriveToGitHub();
}

/** Stops the automatic sync. */
function uninstall() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'syncDriveToGitHub') ScriptApp.deleteTrigger(t);
  }
}

/** The timer calls this. Safe to run by hand at any time. */
function syncDriveToGitHub() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Another run is still in progress; skipped.');
    return 'skipped';
  }
  try {
    const result = runSync_();
    console.log(result);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function runSync_() {
  const props = PropertiesService.getScriptProperties();
  const state = props.getProperties();
  const wanted = listDrivePdfs_();

  const head = gh_('get', '/git/ref/heads/' + CONFIG.branch).object.sha;
  const baseTree = gh_('get', '/git/commits/' + head).tree.sha;
  const tree = gh_('get', '/git/trees/' + baseTree + '?recursive=1');
  if (tree.truncated) throw new Error('The repository tree is too large to read in one request.');

  // Only PDFs under docs/<section>/ belong to the mirror; everything else in the repository is left alone.
  const prefixes = Object.keys(CONFIG.sections).map((s) => 'docs/' + s + '/');
  const inRepo = new Map();
  for (const e of tree.tree) {
    if (e.type === 'blob' && /\.pdf$/i.test(e.path) && prefixes.some((p) => e.path.indexOf(p) === 0)) inRepo.set(e.path, e.sha);
  }

  // An empty listing is far more likely a mistake than an intention: never wipe the site on it.
  if (wanted.size === 0 && inRepo.size > 0) {
    return 'Drive holds no PDF while the site has ' + inRepo.size + '; nothing was removed.';
  }

  const changes = [];
  const newState = {};
  const counts = { added: 0, updated: 0, removed: 0, tooLarge: 0 };

  wanted.forEach((file, path) => {
    const key = stateKey_(path);
    const signature = [file.getId(), file.getLastUpdated().getTime(), file.getSize()].join('|');
    const repoSha = inRepo.get(path);
    // Unchanged in Drive since the last run and still the same blob in the repository: no download.
    if (repoSha && state[key] === signature + '|' + repoSha) {
      newState[key] = state[key];
      return;
    }
    if (file.getSize() > CONFIG.maxFileBytes) {
      counts.tooLarge++;
      console.log('Too large, left as it is: ' + path);
      return;
    }
    const bytes = file.getBlob().getBytes();
    let sha = gitBlobSha_(bytes);
    if (sha !== repoSha) {
      sha = gh_('post', '/git/blobs', { content: Utilities.base64Encode(bytes), encoding: 'base64' }).sha;
      changes.push({ path: path, mode: '100644', type: 'blob', sha: sha });
      if (repoSha) counts.updated++;
      else counts.added++;
    }
    newState[key] = signature + '|' + sha;
  });

  inRepo.forEach((sha, path) => {
    if (!wanted.has(path)) {
      changes.push({ path: path, mode: '100644', type: 'blob', sha: null });
      counts.removed++;
    }
  });

  if (changes.length) {
    const newTree = gh_('post', '/git/trees', { base_tree: baseTree, tree: changes });
    const message = 'Drive sync: ' + counts.added + ' added, ' + counts.updated + ' updated, ' + counts.removed + ' removed';
    const commit = gh_('post', '/git/commits', { message: message, tree: newTree.sha, parents: [head] });
    // Not forced: if someone pushed in the meantime this fails and the next run starts over.
    gh_('patch', '/git/refs/heads/' + CONFIG.branch, { sha: commit.sha, force: false });
  }

  saveState_(props, state, newState);
  return (
    wanted.size + ' PDF in Drive: ' + counts.added + ' added, ' + counts.updated + ' updated, ' + counts.removed + ' removed' +
    (counts.tooLarge ? ', ' + counts.tooLarge + ' too large' : '')
  );
}

/** Map of repository path -> Drive file, for every PDF under the section folders. */
function listDrivePdfs_() {
  const wanted = new Map();
  for (const section of Object.keys(CONFIG.sections)) {
    const folder = DriveApp.getFolderById(CONFIG.sections[section]); // throws when the folder is gone
    if (folder.isTrashed()) throw new Error('The Drive folder of section "' + section + '" is in the trash.');
    walk_(folder, 'docs/' + section, wanted, CONFIG.exactNameSections.indexOf(section) === -1);
  }
  return wanted;
}

function walk_(folder, prefix, wanted, dropCopySuffix) {
  const files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    const path = prefix + '/' + cleanName_(file.getName(), true, dropCopySuffix);
    const other = wanted.get(path);
    // Several files with the same name in one folder: the one put there last is the current version.
    if (!other || newness_(file) > newness_(other)) wanted.set(path, file);
  }
  const folders = folder.getFolders();
  while (folders.hasNext()) {
    const sub = folders.next();
    if (!sub.isTrashed()) walk_(sub, prefix + '/' + cleanName_(sub.getName(), false), wanted, dropCopySuffix);
  }
}

/** When the file arrived in Drive or was last replaced there, whichever is later. */
function newness_(file) {
  return Math.max(file.getDateCreated().getTime(), file.getLastUpdated().getTime());
}

/** A name that is valid in a git path and on Windows, where the repository is also checked out. */
function cleanName_(name, isFile, dropCopySuffix) {
  let n = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim();
  if (isFile) n = n.replace(/\.pdf$/i, '');
  if (isFile && dropCopySuffix) n = n.replace(/ \(\d{1,2}\)$/, ''); // "(1)".."(99)", not a year like "(2026)"
  n = n.replace(/[. ]+$/, '');
  if (n === '' || n === '.git') n = 'بدون اسم';
  return isFile ? n + '.pdf' : n;
}

/** The id git gives a file: sha1("blob <size>\0" + content). */
function gitBlobSha_(bytes) {
  const header = [];
  const text = 'blob ' + bytes.length;
  for (let i = 0; i < text.length; i++) header.push(text.charCodeAt(i));
  header.push(0);
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, header.concat(bytes)));
}

function hex_(bytes) {
  return bytes.map((b) => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function stateKey_(path) {
  return 'f:' + hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, path, Utilities.Charset.UTF_8));
}

function saveState_(props, oldState, newState) {
  const changed = {};
  let any = false;
  for (const key of Object.keys(newState)) {
    if (oldState[key] !== newState[key]) {
      changed[key] = newState[key];
      any = true;
    }
  }
  if (any) props.setProperties(changed, false);
  for (const key of Object.keys(oldState)) {
    if (key.indexOf('f:') === 0 && !(key in newState)) props.deleteProperty(key);
  }
}

function gh_(method, path, body) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Script property GITHUB_TOKEN is missing (Project Settings > Script properties).');
  const options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + CONFIG.owner + '/' + CONFIG.repo + path, options);
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    const hint = code === 401 ? ' (the GitHub token is wrong or expired)' : code === 403 || code === 404 ? ' (the token may lack "Contents: Read and write" on this repository)' : '';
    throw new Error('GitHub ' + method.toUpperCase() + ' ' + path + ' -> ' + code + hint + ': ' + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText());
}
