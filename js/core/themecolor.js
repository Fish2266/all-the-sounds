/* themecolor.js — keep the iOS status bar the same colour as the app.
 *
 * `theme-color` is a static value in the head, but this app ships two themes
 * and the user can switch at any time. Left alone, picking the light theme
 * leaves a near-black band across the Dynamic Island above a bone-white top
 * bar. Read the colour off the element the bar actually sits against instead,
 * so the two cannot drift apart.
 *
 * Two details that matter on iOS:
 *  - The meta is replaced, not edited. Safari does not reliably repaint the
 *    bar when an existing meta's `content` changes under it.
 *  - The chosen theme lives in IndexedDB, which resolves well after the first
 *    paint, so it is mirrored into localStorage for the inline script in the
 *    head to read back on the next visit. (Every app here shares one origin,
 *    hence a per-app key.)
 */
let pending = false;

export function syncThemeColor(selector = '.topbar', storageKey = null) {
  const root = document.documentElement;

  if (storageKey && root.dataset.theme) {
    try { localStorage.setItem(storageKey, root.dataset.theme); } catch { /* private mode */ }
  }

  const source = document.querySelector(selector);
  if (!source) {
    // Prefs are applied before the shell mounts on the first pass. Use the
    // page colour now, and take the real one as soon as the bar exists.
    write(getComputedStyle(document.body).backgroundColor);
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => { pending = false; syncThemeColor(selector, storageKey); });
    }
    return;
  }
  const colour = getComputedStyle(source).backgroundColor;
  // A fully transparent background tells us nothing; fall back to the page.
  write(isOpaque(colour) ? colour : getComputedStyle(document.body).backgroundColor);
}

function isOpaque(colour) {
  if (!colour || colour === 'transparent') return false;
  const a = colour.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
  return !a || parseFloat(a[1]) > 0.9;
}

function write(colour) {
  if (!colour) return;
  for (const stale of document.querySelectorAll('meta[name="theme-color"]')) stale.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = colour;
  document.head.appendChild(meta);
}
