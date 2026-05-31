import { useEffect, useMemo, useState, type ReactNode } from "react";

import { scoreColor } from "../lib/colors";
import { minutes, money, num, ppsqft } from "../lib/format";
import { derive, scoreTooltip } from "../scoring";
import { STATIC } from "../static";
import { useStore } from "../store";
import { type Listing, type Status } from "../types";
import { Editable } from "./Editable";
import { ScoreBadge } from "./ScoreBadge";
import { TagChips } from "./TagChips";

const STATUSES: Status[] = ["candidate", "toured", "rejected", "applied"];

// Only the amenities worth surfacing, in display order. Shown read-only — present
// ones light up, the rest stay muted, so you can read a unit's feature set at a glance.
const AMENITY_LABELS: { key: string; label: string }[] = [
  { key: "in_unit_laundry", label: "In-unit laundry" },
  { key: "in_building_laundry", label: "Building laundry" },
  { key: "parking", label: "Parking" },
  { key: "ev_charging", label: "EV charging" },
  { key: "elevator", label: "Elevator" },
  { key: "doorman", label: "Doorman" },
  { key: "gym", label: "Gym" },
  { key: "roof_deck", label: "Roof deck" },
  { key: "balcony", label: "Balcony" },
  { key: "storage", label: "Storage" },
  { key: "furnished", label: "Furnished" },
];

// The model's per-dimension estimates (commute is derived separately, not auto-rated).
const AUTO_DIMS = ["safety", "value", "quality", "views", "space"] as const;

function daysLabel(days: number | null | undefined): string | null {
  if (days == null) return null;
  if (days <= 0) return "listed today";
  if (days === 1) return "1 day on market";
  return `${days} days on market`;
}

export function DetailDrawer() {
  const selectedId = useStore((s) => s.selectedId);
  const listing = useStore((s) => s.listings.find((l) => l.id === s.selectedId) ?? null);
  const settings = useStore((s) => s.settings)!;
  const catMap = useStore((s) => s.catMap);
  const select = useStore((s) => s.select);
  const updateListing = useStore((s) => s.updateListing);
  const deleteListing = useStore((s) => s.deleteListing);
  const computeCommute = useStore((s) => s.computeCommute);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [computing, setComputing] = useState(false);

  // Reset the gallery whenever a different listing opens.
  useEffect(() => setPhotoIdx(0), [selectedId]);

  const d = useMemo(() => (listing ? derive(listing, settings) : null), [listing, settings]);
  if (!selectedId || !listing || !d) return null;

  const patch = (partial: Partial<Listing>) => updateListing(listing.id, partial);
  const photos = listing.photo_urls ?? [];
  const auto = listing.ratings?.auto ?? {};
  const presentAmenities = AMENITY_LABELS.filter(({ key }) => listing.amenities?.[key]);
  const petPolicy = listing.amenities?.pet_policy as string | undefined;
  const age = daysLabel(listing.days_on_market);

  const runCommute = async () => {
    setComputing(true);
    try {
      await computeCommute(listing.id);
    } finally {
      setComputing(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={() => select(null)} />
      <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-roost-line bg-roost-panel shadow-xl">
        {/* Photo gallery */}
        <div className="relative">
          {photos.length > 0 ? (
            <a href={listing.url || photos[photoIdx]} target="_blank" rel="noreferrer" className="block">
              <img
                src={photos[photoIdx]}
                alt={listing.name}
                className="h-72 w-full bg-roost-bg object-cover"
              />
            </a>
          ) : (
            <div
              className="flex h-40 w-full items-center justify-center text-sm text-roost-muted"
              style={{ backgroundColor: scoreColor(d.score_combined).bg, opacity: 0.15 }}
            />
          )}
          <button
            className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-sm text-white backdrop-blur hover:bg-black/70"
            onClick={() => select(null)}
          >
            Close
          </button>
          {photos.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto bg-roost-panel px-3 py-2">
              {photos.map((u, i) => (
                <button
                  key={i}
                  onClick={() => setPhotoIdx(i)}
                  className={`h-12 w-16 shrink-0 overflow-hidden rounded border-2 transition ${
                    i === photoIdx ? "border-roost-accent" : "border-transparent opacity-70 hover:opacity-100"
                  }`}
                >
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5 p-5">
          {/* Title + score */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold leading-tight">{listing.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-roost-muted">
                <span>{listing.neighborhood || "Unknown neighborhood"}</span>
                {listing.url && (
                  <>
                    <span>·</span>
                    <a
                      href={listing.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-roost-accent hover:underline"
                    >
                      {listing.source || "View source"} ↗
                    </a>
                  </>
                )}
                {age && (
                  <>
                    <span>·</span>
                    <span>{age}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ScoreBadge value={d.score_combined} size="lg" tip={scoreTooltip(listing, settings)} />
              {d.ranked_by === "auto" && (
                <span className="rounded bg-roost-accent/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-roost-accent">
                  AI score
                </span>
              )}
            </div>
          </div>

          {/* Key facts */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-roost-line bg-roost-line sm:grid-cols-3">
            <Fact label="Rent" value={money(listing.rent)} big />
            <Fact label="Beds / Baths" value={`${num(listing.beds)} / ${num(listing.baths)}`} />
            <Fact label="Sqft" value={num(listing.sqft)} />
            <Fact label="$ / sqft" value={ppsqft(d.dollar_per_sqft)} />
            <Fact label="Commute" value={minutes(d.commute_minutes)} />
            <Fact label="Neighborhood" value={listing.neighborhood || "—"} />
          </div>

          {/* Description */}
          {listing.highlights && (
            <section>
              <SectionLabel>Description</SectionLabel>
              <p className="whitespace-pre-line text-sm leading-relaxed text-roost-ink">{listing.highlights}</p>
            </section>
          )}

          {/* Amenities */}
          {(presentAmenities.length > 0 || petPolicy) && (
            <section>
              <SectionLabel>Amenities</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {presentAmenities.map(({ key, label }) => (
                  <span key={key} className="chip chip-on">{label}</span>
                ))}
                {petPolicy && <span className="chip">🐾 {petPolicy}</span>}
              </div>
            </section>
          )}

          {/* Tags */}
          {listing.tags.length > 0 && (
            <section>
              <SectionLabel>Character</SectionLabel>
              <TagChips tags={listing.tags} catMap={catMap} />
            </section>
          )}

          {/* AI assessment (read-only) */}
          <section>
            <SectionLabel>
              AI assessment
              <span className="ml-1 font-normal normal-case text-roost-muted">· estimated by Claude, not a human rating</span>
            </SectionLabel>
            <div className="flex flex-col gap-1.5">
              {AUTO_DIMS.map((dim) => (
                <ScoreBar key={dim} label={dim} value={(auto as Record<string, number>)[dim] ?? null} />
              ))}
              <ScoreBar label="commute" value={null} derivedNote={minutes(d.commute_minutes)} />
            </div>
          </section>

          {/* Commute detail */}
          <section className="flex flex-wrap items-center gap-3 text-sm">
            <SectionLabel className="mb-0 w-full">Commute → {settings.anchor_address || "anchor"}</SectionLabel>
            <span>
              <span className="text-roost-muted">Drive: </span>
              <span className="font-medium tabular-nums">{minutes(d.commute_minutes)}</span>
              {listing.commute?.provider && <span className="ml-1 text-xs text-roost-muted">via {listing.commute.provider}</span>}
            </span>
            {listing.commute?.haversine_km != null && (
              <span className="text-xs text-roost-muted">straight-line {listing.commute.haversine_km.toFixed(1)} km</span>
            )}
            {!STATIC && (
              <button className="btn ml-auto" onClick={runCommute} disabled={computing}>
                {computing ? "Computing…" : d.commute_minutes == null ? "Compute commute" : "Recompute"}
              </button>
            )}
          </section>

          {/* Light personal annotation — the only inputs left */}
          <section className="rounded-lg border border-roost-line bg-roost-bg/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <SectionLabel className="mb-0">Your notes</SectionLabel>
              <select
                className="input !w-auto !py-1 text-xs"
                value={listing.status}
                onChange={(e) => patch({ status: e.target.value as Status })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <Editable multiline value={listing.notes} onSave={(v) => patch({ notes: v })} placeholder="Jot a private note…" />
          </section>

          <div className="flex items-center justify-between pt-1">
            <button
              className="text-sm text-roost-muted hover:text-rose-600"
              onClick={() => {
                if (confirm(`Delete "${listing.name}"? This cannot be undone.`)) deleteListing(listing.id);
              }}
            >
              Delete
            </button>
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noreferrer" className="btn btn-primary">
                Open on {listing.source || "source"} ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value, big = false }: { label: string; value: ReactNode; big?: boolean }) {
  return (
    <div className="bg-roost-panel px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-roost-muted">{label}</div>
      <div className={`tabular-nums ${big ? "text-lg font-semibold" : "text-sm font-medium"}`}>{value}</div>
    </div>
  );
}

function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mb-2 text-xs font-semibold uppercase tracking-wide text-roost-muted ${className}`}>{children}</div>;
}

// Read-only 1-5 bar tinted by value. Used for the AI per-dimension estimates.
function ScoreBar({ label, value, derivedNote }: { label: string; value: number | null; derivedNote?: string }) {
  const pct = value != null ? (Math.max(1, Math.min(5, value)) / 5) * 100 : 0;
  const color = scoreColor(value).bg;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 shrink-0 capitalize text-roost-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-roost-line">
        {value != null && <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />}
      </div>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-roost-muted">
        {value != null ? `${value}/5` : derivedNote ?? "—"}
      </span>
    </div>
  );
}
