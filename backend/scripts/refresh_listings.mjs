// Roost data-refresh primitive — the canonical, repeatable way to keep the
// Craigslist listings in db.json current. Run it whenever you want to re-sync.
//
// In one throttled pass over every Craigslist listing with a url it:
//   1. LIVENESS-CHECKS the link  -> sets link_status: "live" | "dead" | "unknown"
//      (+ checked_at; dead_at when it first goes dead). Dead = 404 or CL's
//      "deleted / expired / flagged" page. The UI hides dead listings by default.
//   2. RE-ENRICHES live listings  -> fills any missing detail fields
//      (sqft/baths/beds/lat/lng/photos/highlights/amenities/tags/listed_at).
//
// It never touches human fields (notes/status/ratings/auto_scored/neighborhood).
// Idempotent and resumable: re-running re-checks liveness and only fills gaps.
//
// SAFETY: Craigslist IP-blocks aggressive scraping (it blocked the home IP once).
// Run this ON A VPN. Concurrency 2, long randomized delays, HARD STOP on the
// first 403/429 or block page. A backup of db.json is written before any change.
//
// Usage:
//   node backend/scripts/refresh_listings.mjs                 (full refresh)
//   node backend/scripts/refresh_listings.mjs --limit 15      (cautious test)
//   node backend/scripts/refresh_listings.mjs --fresh-within 12   (skip rows
//       liveness-checked in the last 12h — cheap incremental re-run)
//   node backend/scripts/refresh_listings.mjs --dead-only     (liveness only,
//       skip re-enrichment)

import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "backend/data/db.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CONCURRENCY = 2;
const BASE_DELAY = 1500;
const JITTER = 1000;
const CHECKPOINT_EVERY = 50;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const has = (name) => process.argv.includes(name);
const LIMIT = arg("--limit") ? Number(arg("--limit")) : Infinity;
const FRESH_WITHIN_H = arg("--fresh-within") ? Number(arg("--fresh-within")) : 0;
const DEAD_ONLY = has("--dead-only");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => BASE_DELAY + Math.floor(Math.random() * JITTER);
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&#x27;|&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#?\w+;/g, " ").trim();
// Drop unpaired UTF-16 surrogates (an emoji whose pair a slice cut) — they crash
// UTF-8 encoding of the API response. Keeps complete emoji pairs intact.
const stripLoneSurrogates = (s) =>
  (s || "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "").replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");

// CL pages that mean the post is gone (returned with HTTP 200, not 404).
const DEAD_MARKERS = /this posting has been (deleted|flagged for removal)|this posting has expired|no longer available/i;

const AMEN = [
  [/w\/?d in unit|laundry in unit|washer.?dryer in/i, "in_unit_laundry"],
  [/laundry (on site|in bldg|in building)|w\/?d hookups?|on-site laundry/i, "in_building_laundry"],
  [/off-?street parking|garage|carport|attached garage|street parking/i, "parking"],
  [/ev charging|electric vehicle/i, "ev_charging"], [/elevator/i, "elevator"],
  [/doorman|concierge/i, "doorman"], [/\bgym\b|fitness/i, "gym"],
  [/roof ?deck|rooftop/i, "roof_deck"], [/balcony|patio|private deck/i, "balcony"],
  [/storage/i, "storage"], [/furnished/i, "furnished"],
];
const TAGS = [
  [/luxury|high-end|designer|modern finishes|renovated|remodeled|brand new/i, "modern luxury finishes"],
  [/high-?rise|tower|\d{2}th floor/i, "high-rise"],
  [/view|skyline|bay view|city view/i, "city/skyline view"],
  [/bright|natural light|sunny|sun-?filled|floor-to-ceiling/i, "bright / abundant natural light"],
  [/hardwood|original detail|victorian|charming|character/i, "classic / character"],
  [/quiet|peaceful/i, "quiet"], [/spacious|large|huge|oversized/i, "spacious"],
];
const bedsFromTitle = (t) => {
  if (/studio/i.test(t)) return 0;
  const m = (t || "").match(/(\d+(?:\.\d+)?)\s*(?:br|bd|bed)/i);
  return m ? Number(m[1]) : null;
};

function parseDetail(h, title) {
  const o = {};
  o.posted = (h.match(/datetime="([^"]+)"/) || [])[1] || null;
  const housing = ((h.match(/class="housing">([\s\S]*?)<\/span>/) || [])[1] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
  const bed = housing.match(/(\d+(?:\.\d+)?)\s*br/i);
  const ba = housing.match(/(\d+(?:\.\d+)?)\s*ba/i) || h.match(/\/\s*(\d+(?:\.\d+)?)\s*Ba/i);
  const sq = housing.match(/(\d{3,5})\s*ft2/i);
  o.beds = /studio/i.test(title + housing) ? 0 : bed ? Number(bed[1]) : bedsFromTitle(title);
  o.baths = ba ? Number(ba[1]) : null;
  o.sqft = sq ? Number(sq[1]) : null;
  const lat = (h.match(/data-latitude="([^"]+)"/) || [])[1];
  const lng = (h.match(/data-longitude="([^"]+)"/) || [])[1];
  if (lat) o.lat = Number(lat);
  if (lng) o.lng = Number(lng);
  o.images = [...new Set((h.match(/https:\/\/images\.craigslist\.org\/[A-Za-z0-9_]+_600x450\.jpg/g) || []))].slice(0, 6);
  o.body = stripLoneSurrogates(decode(((h.match(/id="postingbody"[^>]*>([\s\S]*?)<\/section>/) || [])[1] || "").replace(/<[^>]+>/g, " ")).slice(0, 280));
  const hay = (title + " " + housing + " " + h.slice(0, 20000)).toLowerCase();
  o.amenities = {};
  for (const [re, k] of AMEN) if (re.test(hay)) o.amenities[k] = true;
  if (/cats? (are )?ok/i.test(hay) && /dogs? (are )?ok/i.test(hay)) o.amenities.pet_policy = "cats and dogs ok";
  else if (/cats? (are )?ok/i.test(hay)) o.amenities.pet_policy = "cats ok";
  else if (/dogs? (are )?ok/i.test(hay)) o.amenities.pet_policy = "dogs ok";
  else if (/no pets/i.test(hay)) o.amenities.pet_policy = "no pets";
  o.tags = TAGS.filter(([re]) => re.test(title + " " + o.body)).map(([, t]) => t);
  return o;
}

// Fill only empty/missing fields; never clobber existing good data.
function fillInPlace(l, d) {
  const setIf = (key, cond, val) => { if (cond && val != null) l[key] = val; };
  setIf("beds", l.beds == null, d.beds);
  setIf("baths", l.baths == null, d.baths);
  setIf("sqft", l.sqft == null, d.sqft);
  setIf("lat", l.lat == null, d.lat);
  setIf("lng", l.lng == null, d.lng);
  if ((!l.photo_urls || l.photo_urls.length === 0) && d.images?.length) l.photo_urls = d.images;
  if ((!l.highlights || l.highlights === "") && d.body) l.highlights = d.body;
  if ((!l.amenities || Object.keys(l.amenities).length === 0) && Object.keys(d.amenities).length) l.amenities = d.amenities;
  if (d.tags?.length) l.tags = [...new Set([...(l.tags || []), ...d.tags])];
  if (!l.listed_at) {
    const stamp = d.posted || l.created_at;
    if (stamp) {
      l.listed_at = stamp;
      l.days_on_market = Math.max(0, Math.round((Date.now() - new Date(stamp)) / 86400000));
    }
  }
}

// ---- run ----
const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const freshCutoff = FRESH_WITHIN_H ? Date.now() - FRESH_WITHIN_H * 3600_000 : null;

let targets = db.listings.filter((l) => l.source === "Craigslist" && l.url);
if (freshCutoff) targets = targets.filter((l) => !l.checked_at || new Date(l.checked_at).getTime() < freshCutoff);
if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);
console.log(`refreshing ${targets.length} Craigslist listings (concurrency ${CONCURRENCY}, ~${BASE_DELAY}-${BASE_DELAY + JITTER}ms/req, dead-only=${DEAD_ONLY})`);

const bak = `backend/data/db.backup.refresh-${Date.now()}.json`;
fs.writeFileSync(bak, JSON.stringify(db, null, 2) + "\n");
console.log(`backup -> ${bak}`);

const flush = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n");

let live = 0, dead = 0, unknown = 0, enriched = 0, done = 0;
let stop = false, stopReason = "";

function classifyAndApply(l, status, html) {
  l.checked_at = nowIso();
  // CL serves 410 Gone for expired/deleted posts (404 for some); a few return a
  // 200 "deleted/expired" page with no postingbody.
  if (status === 404 || status === 410 || (html && DEAD_MARKERS.test(html) && !/id="postingbody"/.test(html))) {
    if (l.link_status !== "dead") l.dead_at = nowIso();
    l.link_status = "dead";
    dead++;
    return;
  }
  if (html && /id="postingbody"/.test(html)) {
    l.link_status = "live";
    delete l.dead_at;
    live++;
    if (!DEAD_ONLY) {
      const before = JSON.stringify([l.sqft, l.photo_urls?.length, l.listed_at, l.beds, l.baths]);
      fillInPlace(l, parseDetail(html, l.name || ""));
      if (JSON.stringify([l.sqft, l.photo_urls?.length, l.listed_at, l.beds, l.baths]) !== before) enriched++;
    }
    return;
  }
  // Reachable but unrecognized layout — don't mark dead on a maybe.
  l.link_status = "unknown";
  unknown++;
}

async function worker(items) {
  while (items.length && !stop) {
    const l = items.shift();
    try {
      const r = await fetch(l.url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (r.status === 403 || r.status === 429) { stop = true; stopReason = `HTTP ${r.status} on ${l.url}`; break; }
      const html = r.ok ? await r.text() : "";
      if (html && /request has been blocked|blockID/i.test(html)) { stop = true; stopReason = `block page on ${l.url}`; break; }
      classifyAndApply(l, r.status, html);
    } catch {
      // network/timeout — leave the row as-is, count as unknown for this pass
      l.checked_at = nowIso();
      l.link_status = l.link_status || "unknown";
      unknown++;
    }
    if (++done % 25 === 0) console.log(`  ...${done}/${targets.length} (live=${live} dead=${dead} unknown=${unknown} enriched=${enriched})`);
    if (done % CHECKPOINT_EVERY === 0) flush();
    await sleep(jitter());
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
flush();

const deadTotal = db.listings.filter((l) => l.link_status === "dead").length;
console.log(`\ndone: live=${live} dead=${dead} unknown=${unknown} enriched=${enriched} / processed=${done}`);
console.log(`dead listings in db total: ${deadTotal}`);
if (stop) console.log(`!! STOPPED EARLY: ${stopReason}\n   (re-run to resume; it skips nothing, just re-checks)`);
