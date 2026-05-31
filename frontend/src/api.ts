// Thin typed client. In the normal (backend) build all calls go through the Vite
// proxy at /api -> backend. In the static deploy (VITE_STATIC=true) there is no
// backend, so we swap in the localStorage-backed staticApi (see static.ts).
import { STATIC, staticApi } from "./static";
import type {
  Listing,
  SavedFilter,
  Settings,
  TagsResponse,
} from "./types";

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body = await resp.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(`${resp.status}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

const liveApi = {
  listings: () => req<Listing[]>("/listings"),
  createListing: (body: Partial<Listing>) =>
    req<Listing>("/listings", { method: "POST", body: JSON.stringify(body) }),
  updateListing: (id: string, body: Partial<Listing>) =>
    req<Listing>(`/listings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteListing: (id: string) => req<void>(`/listings/${id}`, { method: "DELETE" }),

  tags: () => req<TagsResponse>("/tags"),

  settings: () => req<Settings>("/settings"),
  putSettings: (body: Settings) =>
    req<Settings>("/settings", { method: "PUT", body: JSON.stringify(body) }),

  savedFilters: () => req<SavedFilter[]>("/saved-filters"),
  createSavedFilter: (body: { name: string; query: object }) =>
    req<SavedFilter>("/saved-filters", { method: "POST", body: JSON.stringify(body) }),
  deleteSavedFilter: (id: string) =>
    req<void>(`/saved-filters/${id}`, { method: "DELETE" }),

  commute: (listingId: string) =>
    req<{ listing_id: string; commute: Listing["commute"] }>(
      `/commute?listing_id=${encodeURIComponent(listingId)}`,
    ),
  recomputeCommute: () =>
    req<{ recomputed: number }>("/commute/recompute", { method: "POST" }),

  exportCsvUrl: () => `${BASE}/export.csv`,
};

// One of these two is the live client; pick based on the build mode.
export const api = STATIC ? staticApi : liveApi;
