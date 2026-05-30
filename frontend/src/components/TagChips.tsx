// Read-only tag chips, color-keyed by category so the qualitative stuff scans fast.

const CAT_COLOR: Record<string, string> = {
  finish: "bg-rose-50 text-rose-700 border-rose-200",
  building: "bg-sky-50 text-sky-700 border-sky-200",
  views: "bg-indigo-50 text-indigo-700 border-indigo-200",
  light: "bg-amber-50 text-amber-700 border-amber-200",
  layout: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amenities: "bg-slate-50 text-slate-700 border-slate-200",
  custom: "bg-roost-bg text-roost-muted border-roost-line",
};

export function TagChips({
  tags,
  catMap,
  max,
}: {
  tags: string[];
  catMap: Record<string, string>;
  max?: number;
}) {
  const shown = max ? tags.slice(0, max) : tags;
  const extra = max ? tags.length - shown.length : 0;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <span
          key={t}
          className={`rounded-full border px-2 py-0.5 text-xs ${
            CAT_COLOR[catMap[t] ?? "custom"] ?? CAT_COLOR.custom
          }`}
        >
          {t}
        </span>
      ))}
      {extra > 0 && <span className="chip">+{extra}</span>}
    </div>
  );
}
