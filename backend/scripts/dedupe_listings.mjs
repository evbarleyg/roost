// Roost dedup primitive. Craigslist landlords repost the same unit under new
// post ids (different id => our id-dedup misses them), so near-identical listings
// pile up. This clusters likely-duplicate listings and marks all but one in each
// cluster with `duplicate_of: <keeper id>`; the UI hides duplicates by default.
//
// Non-destructive and idempotent: it clears prior duplicate_of marks and recomputes
// each run, so it's safe to re-run after a collect/refresh. Nothing is deleted.
//
// Clustering keys (a listing joins a cluster if it shares EITHER with another):
//   A) same first photo URL + same rent   (a reposted unit keeps its photos)
//   B) same normalized name + rent + beds  (catches no-photo reposts)
// Keeper per cluster: prefer live link_status, then most photos, then has sqft,
// then newest. Dead listings are ignored (already hidden).
//
// Usage: node backend/scripts/dedupe_listings.mjs

import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "backend/data/db.json");
const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));

const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

// Operate on visible listings only; clear any prior marks first (idempotent).
for (const l of db.listings) delete l.duplicate_of;
const pool = db.listings.filter((l) => l.link_status !== "dead");

// Union-Find over pool indices.
const parent = pool.map((_, i) => i);
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

const keyA = new Map(); // photo|rent -> index
const keyB = new Map(); // name|rent|beds -> index
pool.forEach((l, i) => {
  const photo = l.photo_urls?.[0];
  if (photo && l.rent != null) {
    const k = `${photo}|${l.rent}`;
    if (keyA.has(k)) union(i, keyA.get(k)); else keyA.set(k, i);
  }
  if (l.name && l.rent != null) {
    const k = `${norm(l.name)}|${l.rent}|${l.beds}`;
    if (keyB.has(k)) union(i, keyB.get(k)); else keyB.set(k, i);
  }
});

// Gather clusters.
const clusters = new Map();
pool.forEach((_, i) => { const r = find(i); (clusters.get(r) ?? clusters.set(r, []).get(r)).push(i); });

// Keeper scoring: higher is better.
const score = (l) => (l.link_status === "live" ? 1000 : 0) + (l.photo_urls?.length || 0) * 10 + (l.sqft ? 5 : 0) +
  (l.listed_at ? new Date(l.listed_at).getTime() / 1e12 : 0);

let marked = 0, dupClusters = 0;
for (const idxs of clusters.values()) {
  if (idxs.length < 2) continue;
  dupClusters++;
  const members = idxs.map((i) => pool[i]);
  const keeper = members.reduce((best, l) => (score(l) > score(best) ? l : best));
  for (const l of members) if (l.id !== keeper.id) { l.duplicate_of = keeper.id; marked++; }
}

const bak = `backend/data/db.backup.dedupe-${Date.now()}.json`;
fs.writeFileSync(bak, JSON.stringify(db, null, 2) + "\n");
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n");
console.log(`backup -> ${bak}`);
console.log(`duplicate clusters: ${dupClusters}; listings marked duplicate (hidden): ${marked}`);
const visible = db.listings.filter((l) => l.link_status !== "dead" && !l.duplicate_of).length;
console.log(`visible after dedupe (non-dead, non-duplicate): ${visible} / ${db.listings.length} total`);
