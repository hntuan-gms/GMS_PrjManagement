/**
 * Token values resolved to concrete colours, for the few places that cannot take a CSS
 * variable: gantt-task-react writes bar colours into SVG `fill` attributes, where `var()`
 * does not resolve. Read from the live stylesheet so a theme switch (dark mode) changes the
 * bars too — callers re-read after `onAppearanceChange` (useAppearance re-renders them).
 */

export interface Palette {
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  lineStrong: string;
  sunken: string;
  sheet: string;
  info: string;
  infoSoft: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  risk: string;
  riskSoft: string;
  son: string;
  sonWash: string;
  dark: boolean;
}

const VARS: Record<Exclude<keyof Palette, "dark">, string> = {
  ink: "--ink",
  ink2: "--ink-2",
  ink3: "--ink-3",
  ink4: "--ink-4",
  line: "--line",
  lineStrong: "--line-strong",
  sunken: "--sunken",
  sheet: "--sheet",
  info: "--info",
  infoSoft: "--info-soft",
  ok: "--ok",
  okSoft: "--ok-soft",
  warn: "--warn",
  warnSoft: "--warn-soft",
  risk: "--risk",
  riskSoft: "--risk-soft",
  son: "--son",
  sonWash: "--son-wash",
};

/** Light-theme values, used where there is no document (tests) or before styles load. */
const FALLBACK: Palette = {
  ink: "rgb(29 28 26)",
  ink2: "rgb(85 82 76)",
  ink3: "rgb(111 107 100)",
  ink4: "rgb(162 157 148)",
  line: "rgb(230 227 220)",
  lineStrong: "rgb(211 206 196)",
  sunken: "rgb(239 237 232)",
  sheet: "rgb(252 251 249)",
  info: "rgb(42 111 219)",
  infoSoft: "rgb(214 227 248)",
  ok: "rgb(47 138 91)",
  okSoft: "rgb(207 231 216)",
  warn: "rgb(183 121 31)",
  warnSoft: "rgb(244 226 187)",
  risk: "rgb(194 51 77)",
  riskSoft: "rgb(245 204 212)",
  son: "rgb(224 83 31)",
  sonWash: "rgb(252 235 227)",
  dark: false,
};

export function readPalette(): Palette {
  if (typeof document === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const out = { ...FALLBACK, dark: document.documentElement.dataset.theme === "dark" };
  for (const [key, name] of Object.entries(VARS) as Array<[keyof typeof VARS, string]>) {
    const v = cs.getPropertyValue(name).trim();
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Categorical colours for "colour by person / Epic": a fixed hue order (not a hash of the id),
 * so the first person on the team is always the same colour and a legend can name it. Lightness
 * is set per theme so a pastel in light mode is a muted tone in dark mode.
 */
const CATEGORY_HUES = [212, 152, 28, 268, 340, 186, 48, 112, 300, 4];

export function categoryColors(index: number, dark: boolean) {
  const h = CATEGORY_HUES[((index % CATEGORY_HUES.length) + CATEGORY_HUES.length) % CATEGORY_HUES.length];
  return dark
    ? { bg: `hsl(${h} 22% 26%)`, progress: `hsl(${h} 48% 58%)`, selected: `hsl(${h} 26% 32%)` }
    : { bg: `hsl(${h} 46% 86%)`, progress: `hsl(${h} 42% 46%)`, selected: `hsl(${h} 46% 79%)` };
}

/** A resolved colour at an opacity, for SVG attributes (which cannot take color-mix or var()). */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const rgb = /^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(color.trim());
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  return color;
}
