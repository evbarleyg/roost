// Targeted, idempotent backfill for list-level Craigslist listings.
//
// Unlike the one-shot enrich_all.mjs (which REPLACES the whole Craigslist set
// from a stale /tmp file and would wipe auto-scores, normalized neighborhoods,
// and ratings), this mutates db.json IN PLACE: it selects only the un-enriched
// rows (source == "Craigslist" AND listed_at is null), fetches each detail page,
// and fills ONLY the missing fields. Everything else — ratings, auto_scored,
// neighborhood, neighborhood_raw, notes, status, commute, created_at — is left
// untouched.
//
// Safety: low concurrency, long randomized delays, and a HARD STOP on the first
// 403/429 (the IP got re-blocked). Failed fetches leave the record unchanged, so
// a re-run simply retries whatever is still un-enriched.
//
// Usage: node backend/scripts/backfill_cl.mjs            (live run)
//        node backend/scripts/backfill_cl.mjs --limit 20 (cap for a cautious test)

import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "backend/data/db.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CONCURRENCY = 2;
const BASE_DELAY = 1500;        // ms between requests per worker
const JITTER = 1000;            // + up to this much random
const CHECKPOINT_EVERY = 50;    // flush db.json to disk every N completions

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => BASE_DELAY + Math.floor(Math.random() * JITTER);
const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&#x27;|&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#?\w+;/g, " ").trim();

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
const iso = (d) => (d ? new Date(d).toISOString().replace(/\.\d+Z$/, "+00:00") : null);

// Parse a detail page into the enrichable fields. Mirrors enrich_all.mjs.
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
  o.body = decode(((h.match(/id="postingbody"[^>]*>([\s\S]*?)<\/section>/) || [])[1] || "").replace(/<[^>]+>/g, " ")).slice(0, 280);
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

// Fill only the empty/missing fields on `l` from parsed detail `d`. Returns the
// set of field names actually changed (for logging); never clobbers good data.
function fillInPlace(l, d) {
  const changed = [];
  const setIf = (key, cond, val) => { if (cond && val != null) { l[key] = val; changed.push(key); } };
  setIf("beds", l.beds == null, d.beds);
  setIf("baths", l.baths == null, d.baths);
  setIf("sqft", l.sqft == null, d.sqft);
  setIf("lat", l.lat == null, d.lat);
  setIf("lng", l.lng == null, d.lng);
  if ((!l.photo_urls || l.photo_urls.length === 0) && d.images && d.images.length) { l.photo_urls = d.images; changed.push("photo_urls"); }
  if ((!l.highlights || l.highlights === "") && d.body) { l.highlights = d.body; changed.push("highlights"); }
  if ((!l.amenities || Object.keys(l.amenities).length === 0) && Object.keys(d.amenities).length) { l.amenities = d.amenities; changed.push("amenities"); }
  if (d.tags && d.tags.length) {
    const merged = [...new Set([...(l.tags || []), ...d.tags])];
    if (merged.length !== (l.tags || []).length) { l.tags = merged; changed.push("tags"); }
  }
  // listed_at is the "enriched" marker the predicate keys on. Use the real
  // posting date when present; otherwise fall back to created_at so a fetched
  // record drops out of the un-enriched set and re-runs don't re-hit it.
  const stamp = d.posted || l.created_at || null;
  if (stamp) {
    l.listed_at = d.posted || l.created_at;
    l.days_on_market = Math.max(0, Math.round((Date.now() - new Date(l.listed_at)) / 86400000));
    changed.push("listed_at");
  }
  l.updated_at = iso(new Date().toISOString());
  return changed;
}

// ---- run ----
const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
let targets = db.listings.filter((l) => l.source === "Craigslist" && !l.listed_at && l.url);
if (Number.isFinite(LIMIT)) targets = targets.slice(0, LIMIT);
console.log(`targeting ${targets.length} un-enriched Craigslist listings (concurrency ${CONCURRENCY}, ~${BASE_DELAY}-${BASE_DELAY + JITTER}ms/req)`);

// backup before any write
const bak = `backend/data/db.backup.backfill-${Date.now()}.json`;
fs.writeFileSync(bak, JSON.stringify(db, null, 2) + "\n");
console.log(`backup -> ${bak}`);

const flush = () => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n");

let ok = 0, fail = 0, done = 0, enriched = 0;
let stop = false, stopReason = "";

async function worker(items) {
  while (items.length && !stop) {
    const l = items.shift();
    try {
      const r = await fetch(l.url, { headers: { "User-Agent": UA } });
      if (r.status === 403 || r.status === 429) { stop = true; stopReason = `HTTP ${r.status} on ${l.url}`; break; }
      if (!r.ok) { fail++; }
      else {
        const html = await r.text();
        if (/request has been blocked|blockID/i.test(html)) { stop = true; stopReason = `block page on ${l.url}`; break; }
        const changed = fillInPlace(l, parseDetail(html, l.name || ""));
        if (changed.length) enriched++;
        ok++;
      }
    } catch (e) {
      fail++;
    }
    if (++done % 25 === 0) console.log(`  ...${done}/${targets.length} (ok=${ok} fail=${fail} enriched=${enriched})`);
    if (done % CHECKPOINT_EVERY === 0) flush();
    await sleep(jitter());
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
flush();

const remaining = db.listings.filter((l) => l.source === "Craigslist" && !l.listed_at).length;
console.log(`\ndone: ok=${ok} fail=${fail} enriched=${enriched} / processed=${done}`);
console.log(`un-enriched Craigslist remaining: ${remaining}`);
if (stop) console.log(`!! STOPPED EARLY: ${stopReason}\n   (re-run later to resume the remaining ${remaining})`);
