import { useMemo, useState, type ReactNode } from "react";

import { facetCounts } from "../scoring";
import { useStore } from "../store";
import type { FilterQuery, Status } from "../types";

const CATEGORY_ORDER = ["finish", "building", "views", "light", "layout", "amenities", "custom"];
const CATEGORY_LABEL: Record<string, string> = {
  finish: "Finish & condition",
  building: "Building type",
  views: "Views",
  light: "Light",
  layout: "Layout",
  amenities: "Amenities",
  custom: "Custom",
};
const STATUSES: Status[] = ["candidate", "toured", "rejected", "applied"];

export function FilterRail() {
  const { listings, settings, tags, catMap, filter, setFilter, clearFilter } = useStore();
  const savedFilters = useStore((s) => s.savedFilters);
  const applySavedFilter = useStore((s) => s.applySavedFilter);
  const saveCurrentFilter = useStore((s) => s.saveCurrentFilter);
  const deleteSavedFilter = useStore((s) => s.deleteSavedFilter);
  const [newFilterName, setNewFilterName] = useState("");

  // Neighborhoods: the preset five plus anything that shows up in the data.
  const neighborhoods = useMemo(() => {
    const set = new Set(settings?.default_neighborhoods ?? []);
    listings.forEach((l) => l.neighborhood && set.add(l.neighborhood));
    return [...set];
  }, [listings, settings]);

  const counts = useMemo(() => {
    if (!settings) return {};
    return facetCounts(
      listings,
      settings,
      filter,
      catMap,
      tags.map((t) => t.label),
    );
  }, [listings, settings, filter, catMap, tags]);

  const byCat = useMemo(() => {
    const out: Record<string, string[]> = {};
    tags.forEach((t) => (out[t.category] ??= []).push(t.label));
    return out;
  }, [tags]);

  if (!settings) return null;

  const toggleTag = (label: string) => {
    const cur = new Set(filter.tags ?? []);
    cur.has(label) ? cur.delete(label) : cur.add(label);
    setFilter({ tags: [...cur] });
  };
  const toggleNeighborhood = (n: string) => {
    const cur = new Set(filter.neighborhoods ?? []);
    cur.has(n) ? cur.delete(n) : cur.add(n);
    setFilter({ neighborhoods: [...cur] });
  };
  const toggleStatus = (s: Status) => {
    const cur = new Set(filter.status ?? []);
    cur.has(s) ? cur.delete(s) : cur.add(s);
    setFilter({ status: [...cur] });
  };
  const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col gap-4 overflow-y-auto border-r border-roost-line bg-roost-panel p-4">
      <Header onClear={clearFilter} />

      {/* Saved presets */}
      <Section title="Saved presets">
        <div className="flex flex-col gap-1">
          {savedFilters.map((sf) => (
            <div key={sf.id} className="flex items-center gap-1">
              <button className="btn flex-1 justify-start" onClick={() => applySavedFilter(sf.query)}>
                {sf.name}
              </button>
              <button
                className="btn px-2 text-roost-muted"
                title="Delete preset"
                onClick={() => deleteSavedFilter(sf.id)}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="mt-1 flex gap-1">
            <input
              className="input"
              placeholder="Save current as…"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
            />
            <button
              className="btn"
              disabled={!newFilterName.trim()}
              onClick={() => {
                saveCurrentFilter(newFilterName.trim());
                setNewFilterName("");
              }}
            >
              Save
            </button>
          </div>
        </div>
      </Section>

      {/* Numeric ranges */}
      <Section title="Basics">
        <Field label={`Rent ≤ (cap $${settings.budget_cap.toLocaleString()})`}>
          <input
            type="number"
            className="input"
            value={filter.rent_max ?? ""}
            onChange={(e) => setFilter({ rent_max: numOrNull(e.target.value) })}
          />
        </Field>
        <Field label="Rent ≥">
          <input
            type="number"
            className="input"
            value={filter.rent_min ?? ""}
            onChange={(e) => setFilter({ rent_min: numOrNull(e.target.value) })}
          />
        </Field>
        <Field label="Sqft ≥">
          <input
            type="number"
            className="input"
            value={filter.sqft_min ?? ""}
            onChange={(e) => setFilter({ sqft_min: numOrNull(e.target.value) })}
          />
        </Field>
        <Field label="Commute ≤ (min)">
          <input
            type="number"
            className="input"
            value={filter.commute_max ?? ""}
            onChange={(e) => setFilter({ commute_max: numOrNull(e.target.value) })}
          />
        </Field>
        <Field label="Beds ≥">
          <input
            type="number"
            className="input"
            value={filter.beds ?? ""}
            onChange={(e) => setFilter({ beds: numOrNull(e.target.value) })}
          />
        </Field>
        <Field label={`Min combined score: ${filter.min_score?.toFixed(1) ?? "any"}`}>
          <input
            type="range"
            min={1}
            max={5}
            step={0.5}
            className="w-full accent-roost-accent"
            value={filter.min_score ?? 1}
            onChange={(e) => setFilter({ min_score: Number(e.target.value) })}
          />
        </Field>
      </Section>

      {/* Must-have quick toggles */}
      <Section title="Must-haves">
        <div className="flex flex-wrap gap-1.5">
          <Toggle on={!!filter.in_unit_laundry} onClick={() => setFilter({ in_unit_laundry: !filter.in_unit_laundry })}>
            In-unit laundry
          </Toggle>
          <Toggle on={!!filter.parking} onClick={() => setFilter({ parking: !filter.parking })}>
            Parking
          </Toggle>
          <Toggle on={!!filter.pet_friendly} onClick={() => setFilter({ pet_friendly: !filter.pet_friendly })}>
            Pet-friendly
          </Toggle>
          <Toggle on={!!filter.show_expired} onClick={() => setFilter({ show_expired: !filter.show_expired })}>
            Show hidden
          </Toggle>
        </div>
      </Section>

      {/* Neighborhoods */}
      <Section title="Neighborhood">
        <div className="flex flex-wrap gap-1.5">
          {neighborhoods.map((n) => (
            <Toggle key={n} on={filter.neighborhoods?.includes(n) ?? false} onClick={() => toggleNeighborhood(n)}>
              {n}
            </Toggle>
          ))}
        </div>
      </Section>

      {/* Status */}
      <Section title="Status">
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <Toggle key={s} on={filter.status?.includes(s) ?? false} onClick={() => toggleStatus(s)}>
              {s}
            </Toggle>
          ))}
        </div>
      </Section>

      {/* Tag facets */}
      <Section title="Tags">
        {CATEGORY_ORDER.filter((c) => byCat[c]?.length).map((cat) => (
          <div key={cat} className="mb-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-roost-muted">
              {CATEGORY_LABEL[cat] ?? cat}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {byCat[cat]
                .slice()
                .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
                .map((label) => {
                  const on = filter.tags?.includes(label) ?? false;
                  const c = counts[label] ?? 0;
                  return (
                    <button
                      key={label}
                      onClick={() => toggleTag(label)}
                      className={`chip ${on ? "chip-on" : ""} ${c === 0 && !on ? "opacity-40" : ""}`}
                    >
                      {label}
                      <span className="tabular-nums">{c}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </Section>
    </aside>
  );
}

function Header({ onClear }: { onClear: () => void }) {
  const filter = useStore((s) => s.filter) as FilterQuery;
  const active = Object.values(filter).filter((v) => v != null && (Array.isArray(v) ? v.length : true)).length;
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold">Filters{active ? ` · ${active}` : ""}</h2>
      <button className="text-xs text-roost-accent hover:underline" onClick={onClear}>
        Clear all
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-roost-muted">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-roost-muted">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className={`chip ${on ? "chip-on" : ""}`}>
      {children}
    </button>
  );
}
