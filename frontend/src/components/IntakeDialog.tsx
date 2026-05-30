import { useState, type ReactNode } from "react";

import { api } from "../api";
import { useStore } from "../store";
import { DIMENSIONS, type Dimension, type ListingDraft } from "../types";
import { Editable } from "./Editable";
import { RatingStars } from "./RatingStars";

type Step = "input" | "review";

export function IntakeDialog() {
  const open = useStore((s) => s.intakeOpen);
  const openIntake = useStore((s) => s.openIntake);
  const createListing = useStore((s) => s.createListing);
  const select = useStore((s) => s.select);

  const [step, setStep] = useState<Step>("input");
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ListingDraft | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep("input");
    setUrl("");
    setText("");
    setDraft(null);
    setError(null);
  };
  const close = () => {
    openIntake(false);
    reset();
  };

  const runExtract = async () => {
    setLoading(true);
    setError(null);
    try {
      const body = mode === "url" && text.trim() === "" ? { url } : { text, url: url || undefined };
      const resp = await api.extract(body);
      if (resp.needs_paste) {
        setMode("text");
        setError(resp.message ?? "Paste the listing text instead.");
      } else if (resp.draft) {
        setDraft(resp.draft);
        setStep("review");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setLoading(true);
    setError(null);
    try {
      const ratings: Record<string, number> = {};
      for (const [k, v] of Object.entries(draft.suggested_ratings ?? {})) {
        if (typeof v === "number") ratings[k] = v;
      }
      const created = await createListing({
        name: draft.name || "Untitled listing",
        address: draft.address ?? "",
        neighborhood: draft.neighborhood ?? "",
        source: draft.source ?? "",
        url: draft.url ?? url ?? "",
        rent: draft.rent ?? null,
        sqft: draft.sqft ?? null,
        beds: draft.beds ?? null,
        baths: draft.baths ?? null,
        amenities: draft.amenities ?? {},
        highlights: draft.highlights ?? "",
        tags: draft.tags ?? [],
        ratings: { you: ratings },
      });
      close();
      select(created.id); // open the detail drawer to confirm/override
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const patchDraft = (p: Partial<ListingDraft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setSuggested = (dim: Dimension, v: number | null) =>
    setDraft((d) =>
      d ? { ...d, suggested_ratings: { ...(d.suggested_ratings ?? {}), [dim]: v } } : d,
    );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8">
      <div className="card w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-roost-line px-5 py-3">
          <h2 className="font-semibold">
            {step === "input" ? "Add a listing — paste & let Claude draft it" : "Review the draft"}
          </h2>
          <button className="btn" onClick={close}>Cancel</button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {step === "input" && (
            <>
              <div className="inline-flex w-fit overflow-hidden rounded-md border border-roost-line text-sm">
                {(["url", "text"] as const).map((m) => (
                  <button
                    key={m}
                    className={`px-3 py-1.5 ${mode === m ? "bg-roost-accent text-white" : "bg-white"}`}
                    onClick={() => setMode(m)}
                  >
                    {m === "url" ? "From URL" : "Paste text"}
                  </button>
                ))}
              </div>

              {mode === "url" ? (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-roost-muted">Listing URL (we'll try to fetch it)</span>
                  <input
                    className="input"
                    placeholder="https://www.zillow.com/…"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <span className="text-xs text-roost-muted">
                    Some sites block bots — if fetch fails you'll be asked to paste the text.
                  </span>
                </label>
              ) : (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-roost-muted">Paste the listing text</span>
                  <textarea
                    className="input min-h-[180px]"
                    placeholder="Spacious 2BR with floor-to-ceiling windows…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Original URL (optional, stored as the link)"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </label>
              )}

              {error && <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div>}

              <div className="flex justify-end">
                <button
                  className="btn btn-primary"
                  onClick={runExtract}
                  disabled={loading || (mode === "url" ? !url.trim() : !text.trim())}
                >
                  {loading ? "Drafting…" : "Draft with Claude"}
                </button>
              </div>
            </>
          )}

          {step === "review" && draft && (
            <>
              <p className="text-sm text-roost-muted">
                Edit anything below. Ratings are <em>suggestions</em> — you'll confirm/override after saving.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name"><Editable value={draft.name} onSave={(v) => patchDraft({ name: v })} /></Field>
                <Field label="Neighborhood"><Editable value={draft.neighborhood} onSave={(v) => patchDraft({ neighborhood: v })} /></Field>
                <Field label="Address"><Editable value={draft.address} onSave={(v) => patchDraft({ address: v })} /></Field>
                <Field label="Source"><Editable value={draft.source} onSave={(v) => patchDraft({ source: v })} /></Field>
                <Field label="Rent"><Editable type="number" value={draft.rent} onSave={(v) => patchDraft({ rent: v ? Number(v) : null })} /></Field>
                <Field label="Sqft"><Editable type="number" value={draft.sqft} onSave={(v) => patchDraft({ sqft: v ? Number(v) : null })} /></Field>
                <Field label="Beds"><Editable type="number" value={draft.beds} onSave={(v) => patchDraft({ beds: v ? Number(v) : null })} /></Field>
                <Field label="Baths"><Editable type="number" value={draft.baths} onSave={(v) => patchDraft({ baths: v ? Number(v) : null })} /></Field>
              </div>

              <Field label="Highlights">
                <Editable multiline value={draft.highlights} onSave={(v) => patchDraft({ highlights: v })} />
              </Field>

              <div>
                <div className="mb-1 text-xs text-roost-muted">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {(draft.tags ?? []).map((t) => (
                    <span key={t} className="chip chip-on">
                      {t}
                      <button className="ml-0.5" onClick={() => patchDraft({ tags: (draft.tags ?? []).filter((x) => x !== t) })}>✕</button>
                    </span>
                  ))}
                  <TagAdder onAdd={(t) => !(draft.tags ?? []).includes(t) && patchDraft({ tags: [...(draft.tags ?? []), t] })} />
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs text-roost-muted">Suggested ratings (commute is computed app-side)</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {DIMENSIONS.map((dim) => (
                    <div key={dim} className="flex items-center justify-between rounded-md border border-roost-line px-2 py-1.5">
                      <span className="text-sm capitalize">{dim}</span>
                      <RatingStars
                        size="sm"
                        value={draft.suggested_ratings?.[dim] ?? null}
                        onChange={dim === "commute" ? undefined : (v) => setSuggested(dim, v)}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

              <div className="flex justify-between">
                <button className="btn" onClick={() => setStep("input")}>← Back</button>
                <button className="btn btn-primary" onClick={saveDraft} disabled={loading}>
                  {loading ? "Saving…" : "Save listing"}
                </button>
              </div>
            </>
          )}
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

function TagAdder({ onAdd }: { onAdd: (t: string) => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className="input w-32"
      placeholder="+ tag"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
    />
  );
}
