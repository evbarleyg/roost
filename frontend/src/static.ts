// Static-deploy data layer. When the app is built with VITE_STATIC=true (the
// public, serverless deploy), there is no FastAPI backend: reads come from the
// baked /data/*.json files and any edits (notes, status, saved filters, settings,
// hides) persist to this browser's localStorage. So each visitor gets a private,
// non-destructive overlay on the shared read-only snapshot.
import type { Listing, RefreshSummary, SavedFilter, Settings, TagsResponse } from "./types";

export const STATIC = import.meta.env.VITE_STATIC === "true";

const K = {
  patches: "roost.patches",   // { [id]: Partial<Listing> }  (notes/status edits)
  hidden: "roost.hidden",     // string[]  (deleted ids)
  settings: "roost.settings", // Settings override
  filters: "roost.filters",   // SavedFilter[]
};

const lsGet = <T>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/private mode */ } };

let baked: Listing[] | null = null;
let bakedSettings: Settings | null = null;
let bakedTags: TagsResponse | null = null;

const loadBaked = async (): Promise<Listing[]> => {
  if (!baked) baked = await fetch("/data/listings.json").then((r) => r.json());
  return baked!;
};

const overlay = (list: Listing[]): Listing[] => {
  const patches = lsGet<Record<string, Partial<Listing>>>(K.patches, {});
  const hidden = new Set(lsGet<string[]>(K.hidden, []));
  return list.filter((l) => !hidden.has(l.id)).map((l) => (patches[l.id] ? { ...l, ...patches[l.id] } : l));
};

export const staticApi = {
  listings: async (): Promise<Listing[]> => overlay(await loadBaked()),

  settings: async (): Promise<Settings> => {
    if (!bakedSettings) bakedSettings = await fetch("/data/settings.json").then((r) => r.json());
    return lsGet<Settings>(K.settings, bakedSettings!);
  },

  tags: async (): Promise<TagsResponse> => {
    if (!bakedTags) bakedTags = await fetch("/data/tags.json").then((r) => r.json());
    return bakedTags!;
  },

  savedFilters: async (): Promise<SavedFilter[]> => lsGet<SavedFilter[]>(K.filters, []),

  updateListing: async (id: string, body: Partial<Listing>): Promise<Listing> => {
    const patches = lsGet<Record<string, Partial<Listing>>>(K.patches, {});
    patches[id] = { ...patches[id], ...body };
    lsSet(K.patches, patches);
    return overlay(await loadBaked()).find((l) => l.id === id)!;
  },

  deleteListing: async (id: string): Promise<void> => {
    const hidden = lsGet<string[]>(K.hidden, []);
    if (!hidden.includes(id)) { hidden.push(id); lsSet(K.hidden, hidden); }
  },

  putSettings: async (s: Settings): Promise<Settings> => { lsSet(K.settings, s); return s; },

  createSavedFilter: async (body: { name: string; query: object }): Promise<SavedFilter> => {
    const filters = lsGet<SavedFilter[]>(K.filters, []);
    const sf = { id: `local-${filters.length}-${body.name}`, name: body.name, query: body.query } as SavedFilter;
    filters.push(sf);
    lsSet(K.filters, filters);
    return sf;
  },

  deleteSavedFilter: async (id: string): Promise<void> => {
    lsSet(K.filters, lsGet<SavedFilter[]>(K.filters, []).filter((f) => f.id !== id));
  },

  // No backend to add a listing or recompute directions in the static build.
  createListing: async (): Promise<Listing> => {
    throw new Error("Adding listings isn't available on the static site.");
  },
  commute: async (listingId: string): Promise<{ listing_id: string; commute: Listing["commute"] }> => {
    const l = (await loadBaked()).find((x) => x.id === listingId);
    return { listing_id: listingId, commute: l?.commute ?? null }; // no-op: keep any baked value
  },
  recomputeCommute: async (): Promise<{ recomputed: number }> => ({ recomputed: 0 }),

  exportCsvUrl: () => "/data/listings.json", // CSV export is hidden in the static UI

  // No backend on the static site, so refresh is always off (the button is hidden).
  refreshStatus: async (): Promise<{ enabled: boolean }> => ({ enabled: false }),
  refresh: async (): Promise<RefreshSummary> => {
    throw new Error("Data refresh isn't available on the static site.");
  },
};
