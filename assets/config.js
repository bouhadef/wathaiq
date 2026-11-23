// The one place to edit the site texts and the sections.
// Keep the section ids and order in sync with SECTIONS in scripts/build-index.mjs.
export const config = {
  title: 'الوثائق التربوية',
  subtitle: 'الأستاذ بوهادف · رياضيات · 2026-2027',
  sections: [
    { id: 'nosos', title: 'دفاتر النصوص', note: 'دفتر لكل قسم' },
    { id: 'yawmi', title: 'الكراس اليومي', note: '' },
    { id: 'tanqit', title: 'دفتر التنقيط', note: 'كل تقويم لكل قسم في ملف' },
    { id: 'mokhatatat', title: 'المخططات السنوية', note: '' },
  ],
  // The public address, written into the printed QR codes.
  siteUrl: 'https://bouhadef.github.io/wathaiq/',
  // Short permanent addresses for printed QR codes: <siteUrl>#/d/<key> opens that file.
  // A printed code keeps pointing at its key, so never rename or reuse a key; add new ones.
  // qr.html prints one sheet of small stickers for each entry.
  shortLinks: {
    'n-1m1': { path: 'docs/nosos/daftar_nusus_1م1.pdf', title: 'دفتر النصوص 1م1' },
    'n-1m2': { path: 'docs/nosos/daftar_nusus_1م2.pdf', title: 'دفتر النصوص 1م2' },
    'n-1m3': { path: 'docs/nosos/daftar_nusus_1م3.pdf', title: 'دفتر النصوص 1م3' },
    'y-1am': { path: 'docs/yawmi/karras_yawmi_1AM.pdf', title: 'الكراس اليومي 1 متوسط' },
  },
  // qr.html: the text under every code, and the sections that get one large code on a page.
  qrLabel: 'البطاقة الفنية',
  qrPosters: ['tanqit'],
  // Arabic titles for files that keep the name their generator gives them, so a new version
  // can be dropped in Drive without renaming. Matched against the file name without ".pdf";
  // the first rule that matches wins, and a file that matches none shows its own name.
  titleRules: [
    [/^daftar_nusus_(.+)$/i, 'دفتر النصوص $1'],
    [/^karras_yawmi_(\d)AM$/i, 'الكراس اليومي $1 متوسط'],
    [/^karras_yawmi_(.+)$/i, 'الكراس اليومي $1'],
  ],
};
