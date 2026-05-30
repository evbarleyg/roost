// A 1-5 rating control rendered as five dots. Click to set, click the active value
// again to clear. Compact enough for inline use in the rank table.

export function RatingStars({
  value,
  onChange,
  size = "md",
  derived = false,
}: {
  value: number | null | undefined;
  onChange?: (v: number | null) => void;
  size?: "sm" | "md";
  derived?: boolean;
}) {
  const dot = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  const readOnly = !onChange;
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            aria-checked={value === n}
            role="radio"
            title={derived ? "Derived from commute minutes" : `Set ${n}`}
            onClick={() => onChange?.(value === n ? null : n)}
            className={`${dot} rounded-full border transition ${
              on
                ? derived
                  ? "border-amber-500 bg-amber-300"
                  : "border-roost-accent bg-roost-accent"
                : "border-roost-line bg-white hover:border-roost-accent"
            } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
          />
        );
      })}
    </div>
  );
}
