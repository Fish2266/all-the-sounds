/* themecolor.js — keep the iOS status bar the same colour as the app.
 *
 * `theme-color` is a static value in the head, but this app ships two themes
 * and the user can switch at any time. Left alone, picking the light theme
 * leaves a near-black band across the Dynamic Island above a bone-white top
 * bar. Read the colour off the element the bar actually sits against instead,
 * so the two cannot drift apart.
 */
let metas = null;
let pending = false;

export function syncThemeColor(selector = '.topbar') {
  const source = document.querySelector(selector);
  if (!source) {
    // Prefs are applied before the shell mounts on the first pass. Use the
    // page colour now, and take the real one as soon as the bar exists.
    write(getComputedStyle(document.body).backgroundColor);
    if (!pending) {
      pending = true;
      requestAnimationFrame(() => { pending = false; syncThemeColor(selector); });
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
  if (!metas) metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (!metas.length) {
    const m = document.createElement('meta');
    m.name = 'theme-color';
    document.head.appendChild(m);
    metas = [m];
  }
  for (const m of metas) m.setAttribute('content', colour);
}
