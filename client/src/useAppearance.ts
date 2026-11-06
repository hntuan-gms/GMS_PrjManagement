import { useSyncExternalStore } from "react";
import { getDensity, getThemeChoice, onAppearanceChange, resolveTheme, type Density, type ThemeChoice } from "./theme";

export interface Appearance {
  choice: ThemeChoice;
  theme: "light" | "dark";
  density: Density;
}

let cached: Appearance | null = null;
function snapshot(): Appearance {
  const choice = getThemeChoice();
  const theme = resolveTheme(choice);
  const density = getDensity();
  if (!cached || cached.choice !== choice || cached.theme !== theme || cached.density !== density) {
    cached = { choice, theme, density };
  }
  return cached;
}

/** Re-renders the caller when the theme or density changes (a menu choice or the OS switching). */
export function useAppearance(): Appearance {
  return useSyncExternalStore(onAppearanceChange, snapshot, snapshot);
}
