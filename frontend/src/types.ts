// Mirrors the backend models (app/models.py). Derived fields are computed
// client-side (see scoring.ts) for instant re-ranking, so the stored shape here
// deliberately excludes them.

export const DIMENSIONS = ["safety", "value", "commute", "quality", "views", "space"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const RATERS = ["you", "fiance"] as const;
export type Rater = (typeof RATERS)[number];
// "auto" is the model's fallback rating; it isn't a human-editable rater, so it's
// kept out of RATERS but is a valid key on a listing's ratings map.
export type RatingsKey = Rater | "auto";

export type Status = "candidate" | "toured" | "rejected" | "applied";

export interface Amenities {
  in_unit_laundry?: boolean | null;
  in_building_laundry?: boolean | null;
  parking?: boolean | null;
  ev_charging?: boolean | null;
  elevator?: boolean | null;
  doorman?: boolean | null;
  gym?: boolean | null;
  roof_deck?: boolean | null;
  balcony?: boolean | null;
  storage?: boolean | null;
  furnished?: boolean | null;
  pet_policy?: string | null;
  [k: string]: boolean | string | null | undefined;
}

export interface CommuteResult {
  minutes: number | null;
  distance_km: number | null;
  mode: string | null;
  provider: string | null;
  haversine_km: number | null;
  computed_at: string | null;
  error: string | null;
}

export type Ratings = Partial<Record<RatingsKey, Partial<Record<Dimension, number | null>>>>;

export interface Listing {
  id: string;
  name: string;
  address: string;
  neighborhood: string;
  // Original free-text neighborhood before normalization to a canonical SF name.
  neighborhood_raw?: string;
  source: string;
  url: string;
  rent: number | null;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  lat: number | null;
  lng: number | null;
  amenities: Amenities;
  highlights: string;
  photo_urls: string[];
  tags: string[];
  notes: string;
  status: Status;
  ratings: Ratings;
  commute_minutes_manual: number | null;
  commute: CommuteResult | null;
  // Real posting date + age from the source detail page (null until enriched).
  listed_at?: string | null;
  days_on_market?: number | null;
  // True when Claude auto-scored this listing (the `auto` ratings rater).
  auto_scored?: boolean;
  // Liveness of the source link, set by the refresh script. Dead = expired/deleted
  // (Craigslist 410/404). Hidden by default in the UI.
  link_status?: "live" | "dead" | "unknown";
  checked_at?: string;
  dead_at?: string;
  // Set by the dedupe script to the id of the kept listing; duplicates are hidden by default.
  duplicate_of?: string;
  created_at: string;
  updated_at: string;
}

export interface CommuteBand {
  max_minutes: number | null;
  rating: number;
}

export interface Settings {
  weights: Record<Dimension, number>;
  commute_bands: CommuteBand[];
  anchor_address: string;
  anchor_latlng: [number, number];
  budget_cap: number;
  default_beds: number;
  default_neighborhoods: string[];
  directions_provider: string;
  directions_mode: string;
  extract_model: string;
  divergence_threshold: number;
}

export interface Tag {
  label: string;
  category: string;
  count?: number;
}

export interface TagsResponse {
  tags: Tag[];
  categories: Record<string, string[]>;
}

export interface SavedFilter {
  id: string;
  name: string;
  query: FilterQuery;
}

export interface Divergence {
  flagged: boolean;
  max_diff: number;
  dimensions: { dimension: Dimension; you: number; fiance: number; diff: number }[];
}

export interface Derived {
  dollar_per_sqft: number | null;
  commute_minutes: number | null;
  score_you: number | null;
  score_fiance: number | null;
  score_auto: number | null;
  score_combined: number | null;
  // "human" if either rater scored, "auto" if the score comes from the model, else "none".
  ranked_by: "human" | "auto" | "none";
  divergence: Divergence;
}

export interface FilterQuery {
  rent_min?: number | null;
  rent_max?: number | null;
  sqft_min?: number | null;
  commute_max?: number | null;
  beds?: number | null;
  neighborhoods?: string[];
  min_score?: number | null;
  tags?: string[];
  status?: Status[];
  in_unit_laundry?: boolean;
  parking?: boolean;
  pet_friendly?: boolean;
  // Dead/expired source links are hidden unless this is on.
  show_expired?: boolean;
}

// A draft returned by POST /listings/extract.
export interface ListingDraft {
  name: string;
  address?: string;
  neighborhood?: string;
  source?: string;
  url?: string;
  rent?: number | null;
  sqft?: number | null;
  beds?: number | null;
  baths?: number | null;
  amenities?: Amenities;
  tags?: string[];
  suggested_ratings?: Partial<Record<Dimension, number | null>>;
  highlights?: string;
}
