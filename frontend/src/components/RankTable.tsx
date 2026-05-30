import { useMemo, useState, type ReactNode } from "react";

import { scoreTint } from "../lib/colors";
import { minutes, money, num, ppsqft } from "../lib/format";
import { derive, minutesToRating, sortListings, type SortKey } from "../scoring";
import { useStore } from "../store";
import type { Listing, Rater } from "../types";
import { RatingStars } from "./RatingStars";
import { ScoreBadge } from "./ScoreBadge";

const EDITABLE_DIMS = ["safety", "value", "quality", "views", "space"] as const;

export function RankTable({ rows }: { rows: Listing[] }) {
  const settings = useStore((s) => s.settings)!;
  const select = useStore((s) => s.select);
  const updateListing = useStore((s) => s.updateListing);
  const [rater, setRater] = useState<Rater>("you");
  const [sort, setSort] = useState<{ key: SortKey | "name"; dir: "asc" | "desc" }>({
    key: "score",
    dir: "desc",
  });

  const sorted = useMemo(() => {
    if (sort.key === "name") {
      return [...rows].sort((a, b) =>
        sort.dir === "asc" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
      );
    }
    return sortListings(rows, settings, sort.key, sort.dir);
  }, [rows, settings, sort]);

  const setRating = (l: Listing, dim: string, v: number | null) => {
    const ratings = { ...(l.ratings ?? {}) };
    const r = { ...(ratings[rater] ?? {}) };
    if (v == null) delete (r as Record<string, number>)[dim];
    else (r as Record<string, number>)[dim] = v;
    ratings[rater] = r;
    updateListing(l.id, { ratings });
  };

  const SortHead = ({ k, children, className = "" }: { k: SortKey | "name"; children: ReactNode; className?: string }) => (
    <th
      className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-semibold hover:text-roost-accent ${className}`}
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }))}
    >
      {children}
      {sort.key === k && <span className="ml-1 text-roost-accent">{sort.dir === "desc" ? "↓" : "↑"}</span>}
    </th>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-roost-muted">
        <span>Editing ratings for</span>
        <div className="inline-flex overflow-hidden rounded-md border border-roost-line">
          {(["you", "fiance"] as Rater[]).map((r) => (
            <button
              key={r}
              className={`px-3 py-1 ${rater === r ? "bg-roost-accent text-white" : "bg-white"}`}
              onClick={() => setRater(r)}
            >
              {r === "you" ? "You" : "Fiancé"}
            </button>
          ))}
        </div>
        <span className="text-xs">· {sorted.length} listings · click a row for details</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-roost-bg text-xs text-roost-muted shadow-sm">
            <tr>
              <SortHead k="score">Score</SortHead>
              <SortHead k="name">Listing</SortHead>
              <SortHead k="rent" className="text-right">Rent</SortHead>
              <SortHead k="ppsqft" className="text-right">$/sqft</SortHead>
              <SortHead k="sqft" className="text-right">Sqft</SortHead>
              <SortHead k="commute" className="text-right">Commute</SortHead>
              {EDITABLE_DIMS.map((d) => (
                <th key={d} className="px-2 py-2 text-center font-semibold capitalize">{d}</th>
              ))}
              <th className="px-2 py-2 text-center font-semibold">Δ</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => {
              const d = derive(l, settings);
              const tint = scoreTint(d.score_combined);
              const commuteDerived = minutesToRating(d.commute_minutes, settings.commute_bands);
              const activeRatings = l.ratings?.[rater] ?? {};
              return (
                <tr
                  key={l.id}
                  className="cursor-pointer border-b border-roost-line hover:bg-roost-bg/60"
                  onClick={() => select(l.id)}
                >
                  <td className="px-3 py-2" style={{ backgroundColor: tint.bg }}>
                    <div className="flex flex-col items-start gap-0.5">
                      <ScoreBadge value={d.score_combined} size="sm" />
                      {d.ranked_by === "auto" && (
                        <span
                          title="Auto-scored by Claude — rate it yourself to override"
                          className="rounded bg-roost-accent/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-roost-accent"
                        >
                          AI
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-roost-muted">
                      <span>{l.neighborhood || "—"}</span>
                      {l.url && (
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-roost-accent hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {l.source || "link"} ↗
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(l.rent)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{ppsqft(d.dollar_per_sqft)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(l.sqft)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div>{minutes(d.commute_minutes)}</div>
                    {commuteDerived != null && (
                      <div className="text-[10px] text-roost-muted">rated {commuteDerived}/5</div>
                    )}
                  </td>
                  {EDITABLE_DIMS.map((dim) => (
                    <td key={dim} className="px-2 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <RatingStars
                        size="sm"
                        value={(activeRatings as Record<string, number>)[dim] ?? null}
                        onChange={(v) => setRating(l, dim, v)}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    {d.divergence.flagged && (
                      <span title={`Raters differ by ${d.divergence.max_diff}`} className="text-rose-600">
                        ⚠
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-roost-muted">
                  No listings match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
