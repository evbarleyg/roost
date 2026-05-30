import { scoreTint } from "../lib/colors";
import { minutes, money, ppsqft } from "../lib/format";
import { derive } from "../scoring";
import { useStore } from "../store";
import type { Listing } from "../types";
import { ScoreBadge } from "./ScoreBadge";
import { TagChips } from "./TagChips";

export function CardGallery({ rows }: { rows: Listing[] }) {
  const settings = useStore((s) => s.settings)!;
  const catMap = useStore((s) => s.catMap);
  const select = useStore((s) => s.select);

  if (!rows.length) {
    return <div className="p-12 text-center text-roost-muted">No listings match the current filters.</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {rows.map((l) => {
        const d = derive(l, settings);
        const photo = l.photo_urls?.[0];
        return (
          <button
            key={l.id}
            onClick={() => select(l.id)}
            className="card group flex flex-col overflow-hidden text-left transition hover:shadow-md"
          >
            <div className="relative h-40 w-full bg-roost-bg" style={{ backgroundColor: scoreTint(d.score_combined).bg }}>
              {photo ? (
                <img src={photo} alt={l.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-roost-muted">No photo</div>
              )}
              <div className="absolute right-2 top-2">
                <ScoreBadge value={d.score_combined} />
              </div>
              {d.divergence.flagged && (
                <span className="absolute left-2 top-2 rounded bg-rose-600 px-1.5 py-0.5 text-xs text-white">
                  ⚠ disagree
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              <div className="flex items-baseline justify-between">
                <h3 className="font-semibold">{l.name}</h3>
                <span className="text-xs text-roost-muted">{l.neighborhood}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm tabular-nums text-roost-muted">
                <span className="font-medium text-roost-ink">{money(l.rent)}/mo</span>
                <span>{ppsqft(d.dollar_per_sqft)}/sqft</span>
                <span>{l.beds ?? "—"}bd / {l.baths ?? "—"}ba</span>
                <span>{minutes(d.commute_minutes)}</span>
              </div>
              <TagChips tags={l.tags} catMap={catMap} max={5} />
            </div>
          </button>
        );
      })}
    </div>
  );
}
