/* themecolor.js — keep the iOS status bar the same colour as the app.
 *
 * Two separate things paint that strip, and both are handled here:
 *
 *  - The root background. With viewport-fit=cover, iOS paints the safe-area
 *    strip behind the status bar from the ROOT element's background. base.css
 *    now sets it, which is the real fix for the white band that showed above
 *    the dark theme.
 *  - `theme-color`, which Safari uses to tint its own chrome. It is read off
 *    the same root background so the two can never disagree.
 *
 * The meta is replaced rather than edited: Safari does not reliably repaint
 * the bar when an existing meta's `content` changes under it. And because the
 * chosen theme lives in IndexedDB — which resolves long after the first paint
 * — the theme is mirrored into localStorage for the inline script in the head
 * to read back on the next visit. (These apps share one origin, hence a
 * per-app key.)
 */
export function syncThemeColor(storageKey = null) {
  const root = document.documentElement;

  if (storageKey && root.dataset.theme) {
    try { localStorage.setItem(storageKey, root.dataset.theme); } catch { /* private mode */ }
  }

  let colour = getComputedStyle(root).backgroundColor;
  if (!isOpaque(colour) && document.body) colour = getComputedStyle(document.body).backgroundColor;
  if (!isOpaque(colour)) return;

  for (const stale of document.querySelectorAll('meta[name="theme-color"]')) stale.remove();
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = colour;
  document.head.appendChild(meta);
}

function isOpaque(colour) {
  if (!colour || colour === 'transparent') return false;
  const a = colour.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/);
  return !a || parseFloat(a[1]) > 0.9;
}
