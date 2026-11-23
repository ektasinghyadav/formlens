// theme.js - light/dark choice. No choice stored = follow the computer's setting (prefers-color-scheme).
// A stored choice is put on <html data-theme="light|dark">; index.css and dashboard.css read it.
// index.html runs the same read before the page paints, so there is no flash of the wrong colours.
const KEY = 'formlens-theme';

export function storedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // storage blocked (private window): just follow the system
  }
}

// What the person is actually looking at right now.
export function currentTheme() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(KEY, theme); } catch { /* still applied for this visit */ }
}
