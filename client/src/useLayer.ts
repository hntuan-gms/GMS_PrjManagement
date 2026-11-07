import { useEffect, useRef } from "react";
import { push, type LayerOptions } from "./layers";

/** Registers a layer in `layers.ts` while `open` is true. `onEscape` may change every render. */
export function useLayer(id: string, open: boolean, options: LayerOptions = {}): void {
  const latest = useRef(options);
  latest.current = options;
  const hasEscape = !!options.onEscape;
  const dismissOnNav = !!options.dismissOnNav;
  useEffect(() => {
    if (!open) return;
    return push(id, {
      dismissOnNav,
      onEscape: hasEscape ? () => latest.current.onEscape?.() : undefined,
    });
  }, [id, open, hasEscape, dismissOnNav]);
}
