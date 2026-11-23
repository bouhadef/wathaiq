import { config } from './config.js';

const app = document.getElementById('app');
const PDFJS_URL = new URL('../vendor/pdfjs/', import.meta.url);

const nf = new Intl.NumberFormat('ar-DZ', { numberingSystem: 'latn' });
const sizeFmt = new Intl.NumberFormat('ar-DZ', { numberingSystem: 'latn', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('ar-DZ', { numberingSystem: 'latn', dateStyle: 'medium' });

const formatSize = (b) => (b < 1024 * 1024 ? `${nf.format(Math.max(1, Math.round(b / 1024)))} ك.ب` : `${sizeFmt.format(b / 1048576)} م.ب`);
const formatDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
};
const urlFor = (path) => path.split('/').map(encodeURIComponent).join('/');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

let index = null; // parsed files.json
let allowed = new Map(); // path -> { file, sectionId }
let viewerCleanup = null;

async function loadIndex() {
  try {
    const res = await fetch('files.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    index = await res.json();
    for (const s of index.sections) for (const g of s.groups) for (const f of g.files) allowed.set(f.path, { file: f, sectionId: s.id });
  } catch {
    index = null;
  }
}

const sectionConf = (id) => config.sections.find((s) => s.id === id);
const sectionData = (id) => index.sections.find((s) => s.id === id);
const countFiles = (s) => s.groups.reduce((n, g) => n + g.files.length, 0);

function setScreen(...nodes) {
  if (viewerCleanup) {
    viewerCleanup();
    viewerCleanup = null;
  }
  document.body.classList.remove('is-viewer');
  app.replaceChildren(...nodes);
}

function message(text, back) {
  const box = el('div', { class: 'status', role: 'alert' }, el('p', { text }));
  if (back) box.append(el('a', { class: 'btn', href: back.href, text: back.label }));
  return box;
}

function topBar(title, backHref) {
  return el('header', { class: 'bar' },
    backHref ? el('a', { class: 'icon-btn', href: backHref, 'aria-label': 'رجوع' }, el('span', { 'aria-hidden': 'true', text: '→' })) : null,
    el('h1', { class: 'bar-title', text: title }));
}

function fileRow(f, sectionTitle) {
  const meta = [formatDate(f.modified), formatSize(f.size)].filter(Boolean).join(' · ');
  return el('li', {},
    el('a', { class: 'file', href: `#/v/${encodeURIComponent(f.path)}` },
      el('span', { class: 'file-icon', 'aria-hidden': 'true', text: 'PDF' }),
      el('span', { class: 'file-text' },
        el('span', { class: 'file-title', text: f.title }),
        el('span', { class: 'file-meta', text: sectionTitle ? `${sectionTitle} · ${meta}` : meta }))));
}

function renderHome() {
  if (!index) return setScreen(message('تعذّر تحميل قائمة الملفات (files.json). تأكد من نشر الموقع بعد تشغيل سكريبت الفهرسة.'));

  const cards = el('ul', { class: 'cards' });
  for (const sc of config.sections) {
    const data = sectionData(sc.id);
    const n = data ? countFiles(data) : 0;
    cards.append(el('li', {},
      el('a', { class: 'card', href: `#/s/${sc.id}` },
        el('span', { class: 'card-title', text: sc.title }),
        sc.note ? el('span', { class: 'card-note', text: sc.note }) : null,
        el('span', { class: 'card-count', text: n === 0 ? 'لا توجد ملفات بعد' : `${nf.format(n)} ملف` }))));
  }

  const results = el('ul', { class: 'files', hidden: true });
  const empty = el('p', { class: 'empty', hidden: true, text: 'لا توجد نتائج' });
  const input = el('input', { type: 'search', class: 'search', placeholder: 'بحث في عناوين الملفات', 'aria-label': 'بحث في عناوين الملفات', autocomplete: 'off', enterkeyhint: 'search' });
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (!q) {
      results.hidden = empty.hidden = true;
      cards.hidden = false;
      return;
    }
    cards.hidden = true;
    for (const s of index.sections)
      for (const g of s.groups)
        for (const f of g.files)
          if (`${f.title} ${g.name}`.toLowerCase().includes(q)) results.append(fileRow(f, [sectionConf(s.id)?.title, g.name].filter(Boolean).join(' / ')));
    results.hidden = !results.children.length;
    empty.hidden = !!results.children.length;
  });

  setScreen(
    el('header', { class: 'hero' }, el('h1', { text: config.title }), el('p', { text: config.subtitle })),
    el('main', { class: 'page' }, input, cards, results, empty));
}

function renderSection(id) {
  const sc = sectionConf(id);
  if (!index || !sc) return setScreen(message(index ? 'هذا القسم غير موجود.' : 'تعذّر تحميل قائمة الملفات (files.json).', { href: '#/', label: 'الصفحة الرئيسية' }));
  const data = sectionData(id);
  const main = el('main', { class: 'page' });
  if (!data || countFiles(data) === 0) main.append(el('p', { class: 'empty', text: 'لا توجد ملفات بعد' }));
  else
    for (const g of data.groups) {
      const sec = el('section', { class: 'group' });
      if (g.name) sec.append(el('h2', { text: g.name }));
      const ul = el('ul', { class: 'files' });
      for (const f of g.files) ul.append(fileRow(f));
      sec.append(ul);
      main.append(sec);
    }
  setScreen(topBar(sc.title, '#/'), main);
}

async function renderViewer(path) {
  const hit = index && allowed.get(path);
  if (!hit) return setScreen(message(index ? 'هذا الملف غير موجود في القائمة.' : 'تعذّر تحميل قائمة الملفات (files.json).', { href: '#/', label: 'الصفحة الرئيسية' }));

  const { file, sectionId } = hit;
  const url = urlFor(file.path);
  const pagesBox = el('div', { class: 'pages' });
  const state = el('p', { class: 'status', text: 'جارٍ تحميل الملف…' });
  const count = el('span', { class: 'pill', text: '' });
  const bar = el('header', { class: 'bar viewer-bar' },
    el('a', { class: 'icon-btn', href: `#/s/${sectionId}`, 'aria-label': 'رجوع' }, el('span', { 'aria-hidden': 'true', text: '→' })),
    el('h1', { class: 'bar-title', text: file.title }),
    count,
    el('a', { class: 'btn small', href: url, download: file.path.split('/').pop(), text: 'تنزيل' }),
    el('a', { class: 'btn small ghost', href: url, target: '_blank', rel: 'noopener', text: 'فتح في تبويب جديد' }));
  setScreen(bar, el('main', { class: 'viewer' }, state, pagesBox));
  document.body.classList.add('is-viewer');

  let cancelled = false;
  let pdfDoc = null;
  let loadingTask = null;
  let observer = null;
  let resizeTimer = 0;
  let lastWidth = 0;
  const pages = [];
  viewerCleanup = () => {
    cancelled = true;
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    observer?.disconnect();
    for (const p of pages) p.task?.cancel();
    loadingTask?.destroy();
  };

  const fail = (text) => {
    state.className = 'status error';
    state.setAttribute('role', 'alert');
    state.replaceChildren(el('p', { text }), el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', text: 'فتح في تبويب جديد' }));
  };

  let pdfjs;
  try {
    pdfjs = await import(new URL('build/pdf.min.mjs', PDFJS_URL).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.min.mjs', PDFJS_URL).href;
    loadingTask = pdfjs.getDocument({
      url: new URL(url, document.baseURI).href,
      cMapUrl: new URL('cmaps/', PDFJS_URL).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('standard_fonts/', PDFJS_URL).href,
      wasmUrl: new URL('wasm/', PDFJS_URL).href,
      iccUrl: new URL('iccs/', PDFJS_URL).href,
    });
    pdfDoc = await loadingTask.promise;
  } catch (err) {
    if (cancelled) return;
    console.error(err);
    return fail('تعذّر فتح هذا الملف. يمكنك تنزيله أو فتحه في تبويب جديد.');
  }
  if (cancelled) return loadingTask.destroy();

  state.remove();
  const np = pdfDoc.numPages;
  count.textContent = np === 1 ? 'صفحة واحدة' : np === 2 ? 'صفحتان' : `${nf.format(np)} ${np <= 10 ? 'صفحات' : 'صفحة'}`;

  // Use the first page's shape as the placeholder height until each page is rendered.
  const first = await pdfDoc.getPage(1);
  if (cancelled) return;
  const fv = first.getViewport({ scale: 1 });
  let defaultRatio = fv.width / fv.height;

  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const wrap = el('div', { class: 'page-wrap', 'data-page': String(n) });
    wrap.style.aspectRatio = String(defaultRatio);
    const p = { n, wrap, canvas: null, task: null, done: false, busy: false, gen: 0, ratio: defaultRatio };
    pages.push(p);
    pagesBox.append(wrap);
  }

  async function renderPage(p) {
    if (p.done || p.busy || cancelled) return;
    p.busy = true;
    const gen = p.gen;
    const width = pagesBox.clientWidth;
    try {
      const page = p.n === 1 ? first : await pdfDoc.getPage(p.n);
      const base = page.getViewport({ scale: 1 });
      const out = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (width / base.width) * out });
      const canvas = el('canvas', { 'aria-label': `الصفحة ${nf.format(p.n)}`, role: 'img' });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      p.ratio = base.width / base.height;
      p.wrap.style.aspectRatio = String(p.ratio);
      p.task = page.render({ canvas, viewport: vp });
      await p.task.promise;
      if (cancelled || gen !== p.gen) return;
      p.wrap.replaceChildren(canvas);
      p.canvas = canvas;
      p.done = true;
      p.wrap.classList.add('ready');
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException' && !cancelled) {
        console.error(err);
        p.wrap.classList.add('page-error');
        p.wrap.textContent = `تعذّر عرض الصفحة ${nf.format(p.n)}`;
      }
    } finally {
      if (gen === p.gen) {
        p.busy = false;
        p.task = null;
      }
    }
  }

  // Free the bitmap of pages far from the viewport so a long file does not exhaust phone memory.
  function release(p) {
    if (!p.done && !p.busy) return;
    p.task?.cancel();
    if (p.canvas) {
      p.canvas.width = p.canvas.height = 0;
      p.canvas = null;
      p.wrap.replaceChildren();
      p.wrap.classList.remove('ready');
    }
    p.done = false;
    p.busy = false;
    p.task = null;
    p.gen++;
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const p = pages[Number(e.target.dataset.page) - 1];
        if (e.isIntersecting) renderPage(p);
        else release(p);
      }
    },
    { rootMargin: '800px 0px' });
  for (const p of pages) observer.observe(p.wrap);
  lastWidth = pagesBox.clientWidth;

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const w = pagesBox.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      for (const p of pages) {
        release(p);
        // Re-observing delivers a fresh callback for pages near the viewport.
        observer.unobserve(p.wrap);
        observer.observe(p.wrap);
      }
    }, 200);
  }
  window.addEventListener('resize', onResize);
}

function route() {
  const hash = location.hash || '#/';
  window.scrollTo(0, 0);
  let m;
  if ((m = hash.match(/^#\/s\/([^/]+)$/))) return renderSection(decodeURIComponent(m[1]));
  if ((m = hash.match(/^#\/v\/(.+)$/))) {
    let path = '';
    try {
      path = decodeURIComponent(m[1]);
    } catch {
      /* malformed: treated as unknown file */
    }
    return renderViewer(path);
  }
  return renderHome();
}

document.title = config.title;
await loadIndex();
window.addEventListener('hashchange', route);
route();
