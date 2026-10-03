import { HOURS_PER_DAY, roundHours } from "../taskForm";

/**
 * Duration is whole calendar days on the Gantt (due = start + duration − 1), so
 * "1.5 ngày" can't be a bar length. Said out loud instead of silently rounded:
 * the bar takes the next whole day, and the 1.5 days of effort go into the
 * Original estimate, which is what the resource heatmap actually reads.
 */
export default function DurationHint({ days }: { days: number }) {
  if (Number.isInteger(days)) return null;
  return (
    <small className="field-hint">
      Trên lịch: {Math.ceil(days)} ngày (làm tròn lên) · ước lượng gợi ý {roundHours(days * HOURS_PER_DAY)}h
    </small>
  );
}
