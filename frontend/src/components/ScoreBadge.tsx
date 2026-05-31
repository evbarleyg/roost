import { scoreColor } from "../lib/colors";
import { score as fmtScore } from "../lib/format";

// `tip` is the per-listing explanation (e.g. "3.80 / 5 = Safety 3 · Value 4 · …"),
// built by scoreTooltip() at the call site so the breakdown stays accurate.
export function ScoreBadge({
  value,
  size = "md",
  tip,
}: {
  value: number | null;
  size?: "sm" | "md" | "lg";
  tip?: string;
}) {
  const { bg, fg } = scoreColor(value);
  const dims =
    size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-7 w-9 text-xs" : "h-9 w-11 text-sm";
  return (
    <span
      className={`inline-flex cursor-help items-center justify-center rounded-lg font-mono font-semibold tabular-nums ${dims}`}
      style={{ backgroundColor: bg, color: fg }}
      title={tip ?? (value == null ? "Not yet scored" : `Overall score ${fmtScore(value)} / 5`)}
    >
      {fmtScore(value)}
    </span>
  );
}
