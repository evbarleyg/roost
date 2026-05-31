import { useMemo, useState, type ReactNode } from "react";

import { scoreTint } from "../lib/colors";
import { minutes, money, num, ppsqft } from "../lib/format";
import { derive, sortListings, type SortKey } from "../scoring";
import { useStore } from "../store";
import type { Listing } from "../types";
import { ScoreBadge } from "./ScoreBadge";

function ageLabel(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days <= 0) return "today";
  return `${days}d`;
}

export function RankTable({ rows }: { rows: Listing[] }) {
  const settings = useStore((s) => s.settings)!;
  const select = useStore((s) => s.select);
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
      <div className="px-4 py-2 text-xs text-roost-muted">
        {sorted.length} listings · click a row for photos and details
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
              <th className="px-3 py-2 text-right font-semibold">Beds</th>
              <SortHead k="commute" className="text-right">Commute</SortHead>
              <th className="px-3 py-2 text-right font-semibold">Age</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l) => {
              const d = derive(l, settings);
              const tint = scoreTint(d.score_combined);
              const photo = l.photo_urls?.[0];
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
                          title="Auto-scored by Claude"
                          className="rounded bg-roost-accent/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-roost-accent"
                        >
                          AI
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-12 shrink-0 overflow-hidden rounded bg-roost-bg">
                        {photo ? (
                          <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[9px] text-roost-muted">no photo</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.name}</div>
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
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">{money(l.rent)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">{ppsqft(d.dollar_per_sqft)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">{num(l.sqft)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">{num(l.beds)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">{minutes(d.commute_minutes)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums text-roost-muted">{ageLabel(l.days_on_market)}</td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-roost-muted">
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
