import { useState } from "react";
import { initialsOf } from "../avatar";

/**
 * One way to draw a person (plan 0-1): the picture Jira gave, or their initials when there is none
 * or it fails to load. The wrapper keeps the caller's size and ring: pass the class the spot already
 * uses (`bd-avatar`, `wbs-avatar`, `rv-avatar`…) and the image fills it.
 */
export default function Avatar({
  name,
  avatarUrl,
  className,
  title,
  decorative,
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  className?: string;
  title?: string;
  /** The name is written beside it, so a screen reader can skip the avatar. */
  decorative?: boolean;
}) {
  // The url that failed, not a flag: a new url gets a fresh try without an effect to reset it.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = !!avatarUrl && failedUrl !== avatarUrl;
  return (
    <span
      className={`avatar${showImage ? " has-img" : ""}${name ? "" : " is-none"}${className ? ` ${className}` : ""}`}
      title={title}
      aria-hidden={decorative ? true : undefined}
    >
      {showImage ? <img src={avatarUrl} alt="" onError={() => setFailedUrl(avatarUrl ?? null)} draggable={false} /> : initialsOf(name)}
    </span>
  );
}
