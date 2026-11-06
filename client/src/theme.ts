/**
 * Appearance preferences: light/dark theme and row density. Per browser, not per account —
 * they describe the screen and the person in front of it, and index.html has to read them
 * before React (and before any session) exists. index.html applies the same rules inline
 * so the first paint is already right; this module keeps them in sync afterwards.
 */

export type ThemeChoice = "light" | "dark" | "system";
export type Density = "compact" | "default" | "comfortable";

const THEME_KEY = "gms.theme";
const DENSITY_KEY = "gms.density";

/** Pixel height of one plan row per density; tokens.css (`--row-h`) holds the same numbers. */
export const ROW_HEIGHTS: Record<Density, number> = { compact: 28, default: 32, comfortable: 40 };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts this page only */
  }
}

export function getThemeChoice(): ThemeChoice {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function getDensity(): Density {
  const v = read(DENSITY_KEY);
  return v === "compact" || v === "comfortable" ? v : "default";
}

const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/** The theme actually shown for a choice. */
export function resolveTheme(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return systemDark() ? "dark" : "light";
  return choice;
}

const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}

/** Subscribe to theme/density changes (also fires when the OS switches while on "system"). */
export function onAppearanceChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply() {
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(getThemeChoice());
  const d = getDensity();
  if (d === "default") delete el.dataset.density;
  else el.dataset.density = d;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", el.dataset.theme === "dark" ? "#121211" : "#f6f5f1");
}

export function setThemeChoice(choice: ThemeChoice) {
  write(THEME_KEY, choice === "system" ? null : choice);
  apply();
  notify();
}

export function setDensity(density: Density) {
  write(DENSITY_KEY, density === "default" ? null : density);
  apply();
  notify();
}

/** Call once at startup: follows the OS while the choice is "system". */
export function initAppearance() {
  apply();
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (getThemeChoice() === "system") {
      apply();
      notify();
    }
  });
}
