// Client-side mirror of backend scoring (app/scoring.py) so the ranking re-computes
// instantly when weights or ratings change — no round-trip. Keep in sync with the
// server copy. Also holds the faceted filter logic used by the filter rail.

import {
  DIMENSIONS,
  type CommuteBand,
  type Derived,
  type Dimension,
  type Divergence,
  type FilterQuery,
  type Listing,
  type RatingsKey,
  type Settings,
} from "./types";

export function commuteMinutes(l: Listing): number | null {
  if (l.commute_minutes_manual != null) return l.commute_minutes_manual;
  return l.commute?.minutes ?? null;
}

export function minutesToRating(minutes: number | null, bands: CommuteBand[]): number | null {
  if (minutes == null) return null;
  const ordered = [...bands].sort((a, b) => {
    const am = a.max_minutes ?? Infinity;
    const bm = b.max_minutes ?? Infinity;
    return am - bm;
  });
  for (const band of ordered) {
    if (band.max_minutes == null || minutes <= band.max_minutes) return band.rating;
  }
  return ordered.length ? ordered[ordered.length - 1].rating : null;
}

function effectiveRatings(l: Listing, rater: RatingsKey, s: Settings): Partial<Record<Dimension, number>> {
  const raw = l.ratings?.[rater] ?? {};
  const out: Partial<Record<Dimension, number>> = {};
  for (const d of DIMENSIONS) {
    const v = raw[d];
    if (typeof v === "number") out[d] = v;
  }
  if (out.commute == null) {
    const derived = minutesToRating(commuteMinutes(l), s.commute_bands);
    if (derived != null) out.commute = derived;
  }
  return out;
}

export function weightedScore(
  ratings: Partial<Record<Dimension, number>>,
  weights: Record<Dimension, number>,
): number | null {
  let num = 0;
  let denom = 0;
  for (const d of DIMENSIONS) {
    const v = ratings[d];
    if (v == null) continue;
    const w = weights[d] ?? 0;
    num += v * w;
    denom += w;
  }
  if (denom === 0) return null;
  return round(num / denom, 3);
}

export function raterScore(l: Listing, rater: RatingsKey, s: Settings): number | null {
  return weightedScore(effectiveRatings(l, rater, s), s.weights);
}

// Falls back to the model's "auto" rating when neither human has scored, so scraped
// listings still rank. Human ratings always win. Mirrors scoring.py combined_score.
export function combinedScore(l: Listing, s: Settings): number | null {
  const scores = (["you", "fiance"] as RatingsKey[])
    .map((r) => raterScore(l, r, s))
    .filter((x): x is number => x != null);
  if (scores.length) return round(scores.reduce((a, b) => a + b, 0) / scores.length, 3);
  return raterScore(l, "auto", s);
}

// Whether the combined score is a human rating or the model's auto fallback.
export function rankedBy(l: Listing): "human" | "auto" | "none" {
  const human = l.ratings ?? {};
  const hasHuman = (["you", "fiance"] as const).some((r) =>
    DIMENSIONS.some((d) => human[r]?.[d] != null),
  );
  if (hasHuman) return "human";
  return l.ratings?.auto ? "auto" : "none";
}

export function dollarPerSqft(l: Listing): number | null {
  if (!l.rent || !l.sqft) return null;
  return round(l.rent / l.sqft, 2);
}

export function divergence(l: Listing, s: Settings): Divergence {
  const threshold = s.divergence_threshold ?? 2;
  const you = l.ratings?.you ?? {};
  const fiance = l.ratings?.fiance ?? {};
  const rows: Divergence["dimensions"] = [];
  let worst = 0;
  for (const d of DIMENSIONS) {
    const a = you[d];
    const b = fiance[d];
    if (a == null || b == null) continue;
    const diff = Math.abs(a - b);
    worst = Math.max(worst, diff);
    rows.push({ dimension: d, you: a, fiance: b, diff });
  }
  return { flagged: worst >= threshold, max_diff: worst, dimensions: rows };
}

export function derive(l: Listing, s: Settings): Derived {
  return {
    dollar_per_sqft: dollarPerSqft(l),
    commute_minutes: commuteMinutes(l),
    score_you: raterScore(l, "you", s),
    score_fiance: raterScore(l, "fiance", s),
    score_auto: raterScore(l, "auto", s),
    score_combined: combinedScore(l, s),
    ranked_by: rankedBy(l),
    divergence: divergence(l, s),
  };
}

// --- filtering (mirrors backend _passes) -----------------------------------

export function passes(
  l: Listing,
  s: Settings,
  f: FilterQuery,
  catMap: Record<string, string>,
): boolean {
  const d = derive(l, s);
  // Hide noise by default: dead (expired/deleted) links and marked duplicates.
  if (!f.show_expired && (l.link_status === "dead" || l.duplicate_of)) return false;
  if (f.rent_min != null && (l.rent == null || l.rent < f.rent_min)) return false;
  if (f.rent_max != null && (l.rent == null || l.rent > f.rent_max)) return false;
  if (f.sqft_min != null && (l.sqft == null || l.sqft < f.sqft_min)) return false;
  if (f.beds != null && (l.beds == null || l.beds < f.beds)) return false;
  if (f.commute_max != null && (d.commute_minutes == null || d.commute_minutes > f.commute_max))
    return false;
  if (f.min_score != null && (d.score_combined == null || d.score_combined < f.min_score))
    return false;
  if (f.neighborhoods?.length && !f.neighborhoods.includes(l.neighborhood)) return false;
  if (f.status?.length && !f.status.includes(l.status)) return false;

  const amen = l.amenities ?? {};
  if (f.in_unit_laundry && !amen.in_unit_laundry) return false;
  if (f.parking && !amen.parking) return false;
  if (f.pet_friendly) {
    const policy = (amen.pet_policy ?? "").toLowerCase();
    if (!policy || policy.includes("no pet")) return false;
  }

  // Faceted tags: AND across categories, OR within a category.
  if (f.tags?.length) {
    const wantByCat: Record<string, Set<string>> = {};
    for (const label of f.tags) {
      const cat = catMap[label] ?? "custom";
      (wantByCat[cat] ??= new Set()).add(label);
    }
    const have = new Set(l.tags ?? []);
    for (const wanted of Object.values(wantByCat)) {
      if (![...wanted].some((t) => have.has(t))) return false;
    }
  }
  return true;
}

// Faceted counts: for each tag, how many listings would match if that tag were
// added to the current filter (classic faceting — the tag's own category is
// relaxed so toggling it on doesn't zero out its siblings).
export function facetCounts(
  listings: Listing[],
  s: Settings,
  f: FilterQuery,
  catMap: Record<string, string>,
  allTags: string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of allTags) {
    const cat = catMap[label] ?? "custom";
    // Drop other tags in the same category from the active filter, then require this one.
    const otherCats = (f.tags ?? []).filter((t) => (catMap[t] ?? "custom") !== cat);
    const probe: FilterQuery = { ...f, tags: [...otherCats, label] };
    counts[label] = listings.filter((l) => passes(l, s, probe, catMap)).length;
  }
  return counts;
}

export type SortKey = "score" | "rent" | "ppsqft" | "sqft" | "commute" | "recency";

export function sortListings(
  listings: Listing[],
  s: Settings,
  key: SortKey,
  dir: "asc" | "desc",
): Listing[] {
  const val = (l: Listing): [boolean, number | string] => {
    const d = derive(l, s);
    switch (key) {
      case "rent":
        return [l.rent == null, l.rent ?? 0];
      case "ppsqft":
        return [d.dollar_per_sqft == null, d.dollar_per_sqft ?? 0];
      case "sqft":
        return [l.sqft == null, l.sqft ?? 0];
      case "commute":
        return [d.commute_minutes == null, d.commute_minutes ?? 0];
      case "recency":
        return [false, l.created_at];
      default:
        return [d.score_combined == null, d.score_combined ?? 0];
    }
  };
  return [...listings].sort((a, b) => {
    const [an, av] = val(a);
    const [bn, bv] = val(b);
    if (an !== bn) return an ? 1 : -1; // nulls always last
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === "desc" ? -cmp : cmp;
  });
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
