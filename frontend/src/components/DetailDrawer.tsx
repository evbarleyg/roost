import { useMemo, useState, type ReactNode } from "react";

import { minutes, ppsqft } from "../lib/format";
import { derive } from "../scoring";
import { useStore } from "../store";
import { DIMENSIONS, type Dimension, type Listing, type Rater, type Status } from "../types";
import { Editable } from "./Editable";
import { RatingStars } from "./RatingStars";
import { ScoreBadge } from "./ScoreBadge";

const STATUSES: Status[] = ["candidate", "toured", "rejected", "applied"];
const AMENITY_TOGGLES: { key: string; label: string }[] = [
  { key: "in_unit_laundry", label: "In-unit laundry" },
  { key: "in_building_laundry", label: "Bldg laundry" },
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

export function DetailDrawer() {
  const selectedId = useStore((s) => s.selectedId);
  const listing = useStore((s) => s.listings.find((l) => l.id === s.selectedId) ?? null);
  const settings = useStore((s) => s.settings)!;
  const tags = useStore((s) => s.tags);
  const select = useStore((s) => s.select);
  const updateListing = useStore((s) => s.updateListing);
  const deleteListing = useStore((s) => s.deleteListing);
  const computeCommute = useStore((s) => s.computeCommute);
  const [tagInput, setTagInput] = useState("");
  const [computing, setComputing] = useState(false);

  const d = useMemo(() => (listing ? derive(listing, settings) : null), [listing, settings]);
  if (!selectedId || !listing || !d) return null;

  const patch = (partial: Partial<Listing>) => updateListing(listing.id, partial);

  const setRating = (rater: Rater, dim: Dimension, v: number | null) => {
    const ratings = { ...(listing.ratings ?? {}) };
    const r = { ...(ratings[rater] ?? {}) } as Record<string, number>;
    if (v == null) delete r[dim];
    else r[dim] = v;
    ratings[rater] = r;
    patch({ ratings });
  };

  const toggleAmenity = (key: string) =>
    patch({ amenities: { ...listing.amenities, [key]: !listing.amenities?.[key] } });

  const addTag = (label: string) => {
    const t = label.trim();
    if (!t || listing.tags.includes(t)) return;
    patch({ tags: [...listing.tags, t] });
    setTagInput("");
  };
  const removeTag = (label: string) => patch({ tags: listing.tags.filter((x) => x !== label) });

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
      <div className="fixed inset-0 z-30 bg-black/20" onClick={() => select(null)} />
      <div className="fixed right-0 top-0 z-40 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-roost-line bg-roost-panel shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-roost-line bg-roost-panel px-5 py-3">
          <div className="flex items-center gap-3">
            <ScoreBadge value={d.score_combined} size="lg" />
            <div>
              <Editable
                value={listing.name}
                onSave={(v) => patch({ name: v })}
                className="!border-transparent !px-0 text-lg font-semibold hover:!border-roost-line"
              />
              <div className="text-xs text-roost-muted">
                You {d.score_you?.toFixed(2) ?? "—"} · Fiancé {d.score_fiance?.toFixed(2) ?? "—"}
                {d.divergence.flagged && <span className="ml-2 text-rose-600">⚠ you disagree</span>}
              </div>
            </div>
          </div>
          <button className="btn" onClick={() => select(null)}>Close</button>
        </div>

        <div className="flex flex-col gap-5 p-5">
          {/* Quick facts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rent">
              <Editable type="number" value={listing.rent} onSave={(v) => patch({ rent: v ? Number(v) : null })} />
            </Stat>
            <Stat label="Sqft">
              <Editable type="number" value={listing.sqft} onSave={(v) => patch({ sqft: v ? Number(v) : null })} />
            </Stat>
            <Stat label="$/sqft (derived)">
              <div className="px-1 py-1.5 text-sm tabular-nums">{ppsqft(d.dollar_per_sqft)}</div>
            </Stat>
            <Stat label="Beds / Baths">
              <div className="flex gap-1">
                <Editable type="number" value={listing.beds} onSave={(v) => patch({ beds: v ? Number(v) : null })} />
                <Editable type="number" value={listing.baths} onSave={(v) => patch({ baths: v ? Number(v) : null })} />
              </div>
            </Stat>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Neighborhood">
              <Editable value={listing.neighborhood} onSave={(v) => patch({ neighborhood: v })} />
            </Stat>
            <Stat label="Source">
              <Editable value={listing.source} onSave={(v) => patch({ source: v })} placeholder="Zillow…" />
            </Stat>
            <Stat label="Address">
              <Editable value={listing.address} onSave={(v) => patch({ address: v })} />
            </Stat>
            <Stat label="Status">
              <select
                className="input"
                value={listing.status}
                onChange={(e) => patch({ status: e.target.value as Status })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Stat>
            <div className="col-span-2">
              <Stat label="Listing URL">
                <div className="flex items-center gap-2">
                  <Editable value={listing.url} onSave={(v) => patch({ url: v })} placeholder="https://…" />
                  {listing.url && (
                    <a href={listing.url} target="_blank" rel="noreferrer" className="btn shrink-0">Open ↗</a>
                  )}
                </div>
              </Stat>
            </div>
          </div>

          {/* Commute */}
          <Box title="Commute → 500 Howard">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <div>
                <span className="text-roost-muted">Minutes: </span>
                <span className="font-medium tabular-nums">{minutes(d.commute_minutes)}</span>
                {listing.commute?.provider && (
                  <span className="ml-1 text-xs text-roost-muted">via {listing.commute.provider}</span>
                )}
              </div>
              {listing.commute?.haversine_km != null && (
                <div className="text-xs text-roost-muted">
                  straight-line {listing.commute.haversine_km.toFixed(1)} km
                </div>
              )}
              <button className="btn" onClick={runCommute} disabled={computing}>
                {computing ? "Computing…" : "Compute commute"}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-roost-muted">Manual override (min):</span>
              <Editable
                type="number"
                value={listing.commute_minutes_manual}
                onSave={(v) => patch({ commute_minutes_manual: v ? Number(v) : null })}
                className="w-24"
              />
            </div>
            {listing.commute?.error && (
              <div className="mt-1 text-xs text-rose-600">lookup error: {listing.commute.error}</div>
            )}
          </Box>

          {/* Dual-rater scoring */}
          <Box title="Ratings — side by side">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-roost-muted">
                  <th className="text-left font-medium">Dimension</th>
                  <th className="text-left font-medium">You</th>
                  <th className="text-left font-medium">Fiancé</th>
                  <th className="text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {DIMENSIONS.map((dim) => {
                  const you = listing.ratings?.you?.[dim] ?? null;
                  const fiance = listing.ratings?.fiance?.[dim] ?? null;
                  const diff = you != null && fiance != null ? Math.abs(you - fiance) : null;
                  const isCommute = dim === "commute";
                  return (
                    <tr key={dim} className="border-t border-roost-line">
                      <td className="py-1.5 capitalize">
                        {dim}
                        {isCommute && <span className="ml-1 text-[10px] text-roost-muted">(auto)</span>}
                      </td>
                      <td className="py-1.5">
                        <RatingStars size="sm" value={you} onChange={(v) => setRating("you", dim, v)} />
                      </td>
                      <td className="py-1.5">
                        <RatingStars size="sm" value={fiance} onChange={(v) => setRating("fiance", dim, v)} />
                      </td>
                      <td className="py-1.5 text-right">
                        {diff != null && diff >= (settings.divergence_threshold ?? 2) ? (
                          <span className="text-rose-600">{diff} ⚠</span>
                        ) : (
                          <span className="text-roost-muted">{diff ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-roost-muted">
              Commute is auto-derived from minutes via the bands; set a star to override.
            </p>
          </Box>

          {/* Tags */}
          <Box title="Tags">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {listing.tags.map((t) => (
                <span key={t} className="chip chip-on">
                  {t}
                  <button className="ml-0.5 text-roost-accent" onClick={() => removeTag(t)}>✕</button>
                </span>
              ))}
              {!listing.tags.length && <span className="text-sm text-roost-muted">No tags yet.</span>}
            </div>
            <div className="flex gap-2">
              <input
                className="input"
                list="tag-vocab"
                placeholder="Add a tag…"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag(tagInput)}
              />
              <datalist id="tag-vocab">
                {tags.map((t) => (
                  <option key={t.label} value={t.label}>{t.category}</option>
                ))}
              </datalist>
              <button className="btn" onClick={() => addTag(tagInput)}>Add</button>
            </div>
          </Box>

          {/* Amenities */}
          <Box title="Amenities">
            <div className="flex flex-wrap gap-1.5">
              {AMENITY_TOGGLES.map(({ key, label }) => (
                <button
                  key={key}
                  className={`chip ${listing.amenities?.[key] ? "chip-on" : ""}`}
                  onClick={() => toggleAmenity(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-roost-muted">Pet policy:</span>
              <Editable
                value={(listing.amenities?.pet_policy as string) ?? ""}
                onSave={(v) => patch({ amenities: { ...listing.amenities, pet_policy: v } })}
                placeholder="cats only…"
              />
            </div>
          </Box>

          {/* Highlights + notes */}
          <Box title="Highlights">
            <Editable multiline value={listing.highlights} onSave={(v) => patch({ highlights: v })} />
          </Box>
          <Box title="Notes">
            <Editable multiline value={listing.notes} onSave={(v) => patch({ notes: v })} placeholder="Private notes…" />
          </Box>

          {/* Photos */}
          <Box title="Photo URLs">
            <div className="flex flex-col gap-1">
              {listing.photo_urls.map((u, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <a href={u} target="_blank" rel="noreferrer" className="flex-1 truncate text-roost-accent">{u}</a>
                  <button
                    className="text-roost-muted"
                    onClick={() => patch({ photo_urls: listing.photo_urls.filter((_, j) => j !== i) })}
                  >✕</button>
                </div>
              ))}
              <Editable
                placeholder="Add photo URL + Enter"
                value=""
                onSave={(v) => v && patch({ photo_urls: [...listing.photo_urls, v] })}
              />
            </div>
          </Box>

          <div className="flex justify-between pt-2">
            <button
              className="btn text-rose-600"
              onClick={() => {
                if (confirm(`Delete "${listing.name}"? This cannot be undone.`)) {
                  deleteListing(listing.id);
                }
              }}
            >
              Delete listing
            </button>
            <button className="btn btn-primary" onClick={() => select(null)}>Done</button>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs text-roost-muted">{label}</div>
      {children}
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}
