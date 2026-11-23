// Printable QR sheets, built from assets/config.js:
//   - one A4 sheet of 60 small stickers (6 columns x 10 rows) for every entry of config.shortLinks;
//   - one page with a single large code for every section listed in config.qrPosters.
// qr.html?only=stickers or ?only=posters prints one kind; ?only=<key> prints a single sheet.
import { config } from './config.js';
import qrcode from '../vendor/qrcode/qrcode.mjs';

const COLUMNS = 6;
const ROWS = 10;
const QUIET = 4; // modules of white margin the QR standard asks for

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

// The code as one SVG path: sharp at any print size. Level Q survives a scuffed sticker.
function qrSvg(text) {
  const qr = qrcode(0, 'Q');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  const size = n + 2 * QUIET;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', text);
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', size);
  bg.setAttribute('height', size);
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}

function stickerSheet(key, link) {
  const url = `${config.siteUrl}#/d/${key}`;
  const sheet = el('section', { class: 'sheet stickers', 'data-key': key });
  for (let i = 0; i < COLUMNS * ROWS; i++) {
    sheet.append(
      el('a', { class: 'sticker', href: url },
        qrSvg(url),
        el('span', { class: 'label', text: config.qrLabel }),
        el('span', { class: 'sub', text: link.title })));
  }
  return sheet;
}

function posterSheet(sectionId) {
  const section = config.sections.find((s) => s.id === sectionId);
  if (!section) return null;
  const url = `${config.siteUrl}#/s/${sectionId}`;
  return el('section', { class: 'sheet poster', 'data-key': sectionId },
    el('a', { class: 'card', href: url },
      el('span', { class: 'poster-title', text: section.title }),
      el('span', { class: 'poster-sub', text: config.subtitle }),
      qrSvg(url),
      el('span', { class: 'label', text: config.qrLabel }),
      el('span', { class: 'hint', text: 'امسح الكود ثم اختر الملف' }),
      el('span', { class: 'url', dir: 'ltr', text: url })));
}

const only = new URLSearchParams(location.search).get('only');
const sheets = document.getElementById('sheets');
if (!only || only === 'stickers' || config.shortLinks[only]) {
  for (const [key, link] of Object.entries(config.shortLinks)) if (!only || only === 'stickers' || only === key) sheets.append(stickerSheet(key, link));
}
if (!only || only === 'posters' || config.qrPosters.includes(only)) {
  for (const id of config.qrPosters) {
    const page = (!only || only === 'posters' || only === id) && posterSheet(id);
    if (page) sheets.append(page);
  }
}
document.getElementById('print').addEventListener('click', () => window.print());
document.documentElement.dataset.ready = 'true';
