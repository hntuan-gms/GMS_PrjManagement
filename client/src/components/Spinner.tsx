/**
 * Waiting for something that has to arrive whole. One turning ring, and nothing else is drawn until
 * everything is here: a screen that fills in piece by piece (a box, then a list, then a count) reads as
 * jank, so the whole area waits and appears once (MASTER.md, "Chờ dữ liệu"). It shows itself only after
 * 120ms, so an answer that is already held or quick never flashes one. `block` centres it in the space it
 * is given.
 */
export default function Spinner({ block = false, label = "Đang tải", className = "" }: { block?: boolean; label?: string; className?: string }) {
  const ring = <span className="spinner" role="status" aria-label={label} />;
  return block ? <div className={`spinner-block${className ? ` ${className}` : ""}`}>{ring}</div> : ring;
}
