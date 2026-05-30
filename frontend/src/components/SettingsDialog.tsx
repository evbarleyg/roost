import { useState, type ReactNode } from "react";

import { useStore } from "../store";
import { DIMENSIONS, type Settings } from "../types";

// Editing weights updates the store live (instant re-rank) and persists on commit.
export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const openSettings = useStore((s) => s.openSettings);
  const settings = useStore((s) => s.settings);
  const setSettingsLocal = useStore((s) => s.setSettingsLocal);
  const saveSettings = useStore((s) => s.saveSettings);
  const recomputeAll = useStore((s) => s.recomputeAllCommutes);
  const [recomputing, setRecomputing] = useState(false);

  if (!open || !settings) return null;

  const weightSum = DIMENSIONS.reduce((a, d) => a + (settings.weights[d] ?? 0), 0);

  // live preview
  const preview = (patch: Partial<Settings>) => setSettingsLocal({ ...settings, ...patch });
  const persist = () => saveSettings(settings);

  const setWeight = (dim: string, v: number) =>
    preview({ weights: { ...settings.weights, [dim]: v } });

  const setBand = (i: number, key: "max_minutes" | "rating", v: number | null) => {
    const bands = settings.commute_bands.map((b, j) => (j === i ? { ...b, [key]: v } : b));
    preview({ commute_bands: bands });
  };

  const runRecompute = async () => {
    await persist();
    setRecomputing(true);
    try {
      await recomputeAll();
    } finally {
      setRecomputing(false);
    }
  };

  const close = () => {
    persist();
    openSettings(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8">
      <div className="card w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-roost-line px-5 py-3">
          <h2 className="font-semibold">Settings</h2>
          <button className="btn btn-primary" onClick={close}>Done</button>
        </div>

        <div className="flex flex-col gap-6 p-5" onPointerUp={persist} onBlur={persist}>
          {/* Weights */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Scoring weights</h3>
              <span className={`text-xs ${Math.abs(weightSum - 1) > 0.001 ? "text-amber-700" : "text-roost-muted"}`}>
                sum {(weightSum * 100).toFixed(0)}% (auto-normalized)
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {DIMENSIONS.map((dim) => {
                const w = settings.weights[dim] ?? 0;
                const pct = weightSum ? (w / weightSum) * 100 : 0;
                return (
                  <div key={dim} className="flex items-center gap-3">
                    <span className="w-20 text-sm capitalize">{dim}</span>
                    <input
                      type="range"
                      min={0}
                      max={0.5}
                      step={0.01}
                      value={w}
                      onChange={(e) => setWeight(dim, Number(e.target.value))}
                      className="flex-1 accent-roost-accent"
                    />
                    <span className="w-24 text-right text-sm tabular-nums text-roost-muted">
                      {(w * 100).toFixed(0)}% → {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Commute bands */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">Commute bands (minutes → rating)</h3>
            <div className="flex flex-col gap-1.5">
              {settings.commute_bands.map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-roost-muted">≤</span>
                  <input
                    type="number"
                    className="input w-24"
                    placeholder="∞"
                    value={b.max_minutes ?? ""}
                    onChange={(e) => setBand(i, "max_minutes", e.target.value === "" ? null : Number(e.target.value))}
                  />
                  <span className="text-roost-muted">min →</span>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    className="input w-20"
                    value={b.rating}
                    onChange={(e) => setBand(i, "rating", Number(e.target.value))}
                  />
                  <span className="text-roost-muted">/ 5</span>
                </div>
              ))}
            </div>
          </section>

          {/* Anchor + directions */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Commute anchor address">
              <input className="input" value={settings.anchor_address} onChange={(e) => preview({ anchor_address: e.target.value })} />
            </Field>
            <Field label="Anchor lat,lng">
              <input
                className="input"
                value={settings.anchor_latlng.join(", ")}
                onChange={(e) => {
                  const [la, ln] = e.target.value.split(",").map((x) => Number(x.trim()));
                  if (!Number.isNaN(la) && !Number.isNaN(ln)) preview({ anchor_latlng: [la, ln] });
                }}
              />
            </Field>
            <Field label="Directions provider">
              <select className="input" value={settings.directions_provider} onChange={(e) => preview({ directions_provider: e.target.value })}>
                <option value="osrm">OSRM (no key, driving)</option>
                <option value="google">Google (transit/walk, key)</option>
                <option value="mapbox">Mapbox (key)</option>
                <option value="ors">OpenRouteService (key)</option>
              </select>
            </Field>
            <Field label="Travel mode">
              <select className="input" value={settings.directions_mode} onChange={(e) => preview({ directions_mode: e.target.value })}>
                <option value="driving">driving</option>
                <option value="transit">transit</option>
                <option value="walking">walking</option>
                <option value="cycling">cycling</option>
              </select>
            </Field>
          </section>

          {/* Defaults */}
          <section className="grid grid-cols-2 gap-3">
            <Field label="Budget cap ($/mo)">
              <input type="number" className="input" value={settings.budget_cap} onChange={(e) => preview({ budget_cap: Number(e.target.value) })} />
            </Field>
            <Field label="Default beds">
              <input type="number" className="input" value={settings.default_beds} onChange={(e) => preview({ default_beds: Number(e.target.value) })} />
            </Field>
            <Field label="Divergence threshold (Δ)">
              <input type="number" min={1} max={4} className="input" value={settings.divergence_threshold} onChange={(e) => preview({ divergence_threshold: Number(e.target.value) })} />
            </Field>
            <Field label="Intake model">
              <input className="input" value={settings.extract_model} onChange={(e) => preview({ extract_model: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label="Default neighborhoods (comma-separated)">
                <input
                  className="input"
                  value={settings.default_neighborhoods.join(", ")}
                  onChange={(e) => preview({ default_neighborhoods: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                />
              </Field>
            </div>
          </section>

          <div className="flex items-center justify-between border-t border-roost-line pt-3">
            <span className="text-xs text-roost-muted">
              Changing the anchor or provider? Re-run commute lookups for all listings.
            </span>
            <button className="btn" onClick={runRecompute} disabled={recomputing}>
              {recomputing ? "Recomputing…" : "Recompute all commutes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-roost-muted">{label}</span>
      {children}
    </label>
  );
}
