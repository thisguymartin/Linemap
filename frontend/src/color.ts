// Route colour derivations. Every project owns one route colour; buttons and
// text in that colour must still clear 4.5:1, so the ink and a button shade
// are derived per route instead of assuming white-on-colour works.

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function luminance([r, g, b]: [number, number, number]): number {
  const ch = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const WHITE: [number, number, number] = [255, 255, 255];
const DARK_INK: [number, number, number] = [21, 24, 28];
const LIGHT_BG: [number, number, number] = [255, 255, 255];
const DARK_BG: [number, number, number] = [17, 19, 22];

export interface RouteTokens {
  route: string;
  ink: string;
  button: string;
  text: string;
}

// Shift a colour toward `toward` until it clears the ratio against `against`.
function fit(color: [number, number, number], against: [number, number, number], toward: [number, number, number], ratio = 4.5): [number, number, number] {
  let c = color;
  for (let i = 0; i < 40 && contrast(c, against) < ratio; i++) c = mix(c, toward, 0.06);
  return c;
}

export function routeTokens(hex: string, theme: 'light' | 'dark'): RouteTokens {
  const rgb = hexToRgb(hex) ?? [36, 87, 214];
  const bg = theme === 'dark' ? DARK_BG : LIGHT_BG;
  let ink = WHITE;
  let button = rgb;
  if (contrast(rgb, WHITE) < 4.5) {
    if (contrast(rgb, DARK_INK) >= 4.5) ink = DARK_INK;
    else button = fit(rgb, WHITE, [0, 0, 0]);
  }
  const text = fit(rgb, bg, theme === 'dark' ? WHITE : [0, 0, 0]);
  return { route: hex, ink: rgbToHex(ink), button: rgbToHex(button), text: rgbToHex(text) };
}

export function routeStyle(hex: string, theme: 'light' | 'dark'): Record<string, string> {
  const t = routeTokens(hex, theme);
  return { '--route': t.route, '--route-ink': t.ink, '--route-btn': t.button, '--route-text': t.text };
}

export function applyRoute(hex: string | null, theme: 'light' | 'dark'): void {
  const root = document.documentElement.style;
  if (!hex) {
    for (const key of ['--route', '--route-ink', '--route-btn', '--route-text']) root.removeProperty(key);
    return;
  }
  for (const [key, value] of Object.entries(routeStyle(hex, theme))) root.setProperty(key, value);
}
