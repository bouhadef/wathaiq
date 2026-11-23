// The one place to edit the site texts and the sections.
// Keep the section ids and order in sync with SECTIONS in scripts/build-index.mjs.
export const config = {
  title: 'الوثائق التربوية',
  subtitle: 'الأستاذ بوهادف · رياضيات · 2026-2027',
  sections: [
    { id: 'nosos', title: 'دفاتر النصوص', note: 'مجلد فرعي لكل قسم' },
    { id: 'yawmi', title: 'الكراس اليومي', note: '' },
    { id: 'tanqit', title: 'دفتر التنقيط', note: 'مجلد فرعي لكل قسم، وكل ملف تقويم واحد' },
    { id: 'mokhatatat', title: 'المخططات السنوية', note: '' },
  ],
};
