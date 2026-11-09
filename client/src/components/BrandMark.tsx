/**
 * The Gimasys logo, from public/brand/ (cut from the company's own logo file).
 *
 * `BrandMark` is the square "Gi" (the rail's home button); `BrandLogo` is the full wordmark with
 * its tagline (the login card). Both are background images chosen by the `--brand-*` tokens, so
 * dark mode swaps in the light-text copy and only the one in use is downloaded. The favicon
 * (public/favicon.svg) and the splash in index.html use the same files: change them together.
 */
export default function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return <span className={`brand-mark ${className}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** The wordmark is 422 × 114. */
export function BrandLogo({ width = 180, className = "" }: { width?: number; className?: string }) {
  return (
    <span
      className={`brand-logo ${className}`}
      style={{ width, height: Math.round((width * 114) / 422) }}
      role="img"
      aria-label="Gimasys"
    />
  );
}
