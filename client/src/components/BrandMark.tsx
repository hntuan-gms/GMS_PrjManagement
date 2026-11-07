/**
 * The GMS mark: a G (Gimasys) on an ink tile, its crossbar a timeline with a son dot where
 * "now" sits on it. Ink and paper swap in dark mode through the tokens (`.brand-*` in shell.css),
 * so the tile never sinks into the background. The same drawing, with fixed colours, is the
 * favicon (public/favicon.svg) and the splash in index.html: change all three together.
 */
export const BRAND_ARC = "M22.4 10.2A8.5 8.5 0 1 0 24.5 16H17";

export default function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`brand-mark ${className}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="brand-tile" width="32" height="32" rx="8" />
      <path className="brand-g" d={BRAND_ARC} fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle className="brand-dot" cx="13.4" cy="16" r="2.2" />
    </svg>
  );
}
