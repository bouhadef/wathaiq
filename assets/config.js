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
  // Arabic titles for files that keep the name their generator gives them, so a new version
  // can be dropped in Drive without renaming. Matched against the file name without ".pdf";
  // the first rule that matches wins, and a file that matches none shows its own name.
  titleRules: [
    [/^daftar_nusus_(.+)$/i, 'دفتر النصوص $1'],
    [/^karras_yawmi_(\d)AM$/i, 'الكراس اليومي $1 متوسط'],
    [/^karras_yawmi_(.+)$/i, 'الكراس اليومي $1'],
  ],
};
