// Global app state (zustand). Holds the raw listings/settings/tags; all scoring &
// filtering is derived on read via scoring.ts so weight edits re-rank instantly.
import { create } from "zustand";

import { api } from "./api";
import type { FilterQuery, Listing, SavedFilter, Settings, Tag } from "./types";

export type ViewMode = "table" | "cards" | "map";

interface State {
  listings: Listing[];
  settings: Settings | null;
  tags: Tag[];
  catMap: Record<string, string>; // tag label -> category
  savedFilters: SavedFilter[];
  filter: FilterQuery;
  view: ViewMode;
  selectedId: string | null;
  intakeOpen: boolean;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  refreshTags: () => Promise<void>;
  setFilter: (patch: Partial<FilterQuery>) => void;
  clearFilter: () => void;
  applySavedFilter: (q: FilterQuery) => void;
  setView: (v: ViewMode) => void;
  select: (id: string | null) => void;
  openIntake: (open: boolean) => void;
  openSettings: (open: boolean) => void;

  createListing: (body: Partial<Listing>) => Promise<Listing>;
  updateListing: (id: string, body: Partial<Listing>) => Promise<void>;
  deleteListing: (id: string) => Promise<void>;
  setSettingsLocal: (s: Settings) => void; // live preview (re-rank) without persisting
  saveSettings: (s: Settings) => Promise<void>;
  computeCommute: (id: string) => Promise<void>;
  recomputeAllCommutes: () => Promise<void>;
  saveCurrentFilter: (name: string) => Promise<void>;
  deleteSavedFilter: (id: string) => Promise<void>;
}

export const useStore = create<State>((set, get) => ({
  listings: [],
  settings: null,
  tags: [],
  catMap: {},
  savedFilters: [],
  filter: {},
  view: "table",
  selectedId: null,
  intakeOpen: false,
  settingsOpen: false,
  loading: true,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const [listings, settings, tagsResp, savedFilters] = await Promise.all([
        api.listings(),
        api.settings(),
        api.tags(),
        api.savedFilters(),
      ]);
      const catMap = Object.fromEntries(tagsResp.tags.map((t) => [t.label, t.category]));
      set({
        listings,
        settings,
        tags: tagsResp.tags,
        catMap,
        savedFilters,
        // Seed the filter with the search defaults (2 bed, budget cap).
        filter: { beds: settings.default_beds, rent_max: settings.budget_cap },
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  refreshTags: async () => {
    const tagsResp = await api.tags();
    set({
      tags: tagsResp.tags,
      catMap: Object.fromEntries(tagsResp.tags.map((t) => [t.label, t.category])),
    });
  },

  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),
  clearFilter: () => set({ filter: {} }),
  applySavedFilter: (q) => set({ filter: { ...q } }),
  setView: (view) => set({ view }),
  select: (selectedId) => set({ selectedId }),
  openIntake: (intakeOpen) => set({ intakeOpen }),
  openSettings: (settingsOpen) => set({ settingsOpen }),

  createListing: async (body) => {
    const created = await api.createListing(body);
    set({ listings: [...get().listings, created] });
    await get().refreshTags();
    return created;
  },

  updateListing: async (id, body) => {
    const updated = await api.updateListing(id, body);
    set({ listings: get().listings.map((l) => (l.id === id ? updated : l)) });
    if (body.tags) await get().refreshTags();
  },

  deleteListing: async (id) => {
    await api.deleteListing(id);
    set({
      listings: get().listings.filter((l) => l.id !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
  },

  setSettingsLocal: (settings) => set({ settings }),

  saveSettings: async (s) => {
    const saved = await api.putSettings(s);
    set({ settings: saved });
  },

  computeCommute: async (id) => {
    const res = await api.commute(id);
    set({
      listings: get().listings.map((l) =>
        l.id === id ? { ...l, commute: res.commute } : l,
      ),
    });
  },

  recomputeAllCommutes: async () => {
    await api.recomputeCommute();
    set({ listings: await api.listings() });
  },

  saveCurrentFilter: async (name) => {
    const sf = await api.createSavedFilter({ name, query: get().filter });
    set({ savedFilters: [...get().savedFilters, sf] });
  },

  deleteSavedFilter: async (id) => {
    await api.deleteSavedFilter(id);
    set({ savedFilters: get().savedFilters.filter((s) => s.id !== id) });
  },
}));
