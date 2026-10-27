import { priorityTone } from "../boardModel";
import { Icon, type IconName } from "./Icons";

const ICON: Record<"high" | "mid" | "low", IconName> = { high: "chevronUp", mid: "equals", low: "chevronDown" };

/**
 * A card's priority as a glyph — chevron up, equals, chevron down — in the tone's colour.
 * The shape carries the meaning, not the colour alone, and the real Jira name is in the
 * tooltip and the accessible name (a site's own priority names are not "High"/"Low").
 */
export default function PriorityMark({ priority }: { priority: string | null }) {
  const tone = priorityTone(priority);
  if (!tone) return null;
  return (
    <span className={`bd-prio bd-prio-${tone}`} role="img" aria-label={`Ưu tiên: ${priority}`} title={`Ưu tiên: ${priority}`}>
      <Icon name={ICON[tone]} size={14} />
    </span>
  );
}
