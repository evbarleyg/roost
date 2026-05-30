import { scoreColor } from "../lib/colors";
import { score as fmtScore } from "../lib/format";

export function ScoreBadge({ value, size = "md" }: { value: number | null; size?: "sm" | "md" | "lg" }) {
  const { bg, fg } = scoreColor(value);
  const dims =
    size === "lg" ? "h-12 w-12 text-lg" : size === "sm" ? "h-7 w-9 text-xs" : "h-9 w-11 text-sm";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-semibold tabular-nums ${dims}`}
      style={{ backgroundColor: bg, color: fg }}
      title={value == null ? "Not yet scored" : `Combined score ${fmtScore(value)} / 5`}
    >
      {fmtScore(value)}
    </span>
  );
}
