import { todayInColumn } from "../resourceColumns";

/** Today's day inside a week or month cell, drawn where the day is, like the line in the rows below. */
export default function TodayInCell({ start, end, today }: { start: string; end: string; today: string }) {
  const at = todayInColumn(start, end, today);
  if (!at) return null;
  return <span className="rv-cell-today" style={{ left: `${at.left * 100}%`, width: `${at.width * 100}%` }} aria-hidden="true" />;
}
