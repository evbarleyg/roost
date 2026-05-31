// Roost discovery primitive — find NEW Craigslist SF rental posts and append them
// to db.json. Pairs with refresh_listings.mjs: this DISCOVERS new posts (adds them
// list-level), refresh then ENRICHES + liveness-checks them. Auto-scoring of the
// new rows is done separately in a Claude Code session.
//
// CL caps a static search at ~357 results, so we partition by price band. We
// dedupe against the post ids already in db.json (listing.id == CL pid for these),
// so re-running only ever adds genuinely-new posts. Existing rows are untouched.
//
// SAFETY: run ON A VPN (CL IP-blocks scraping). Only ~9 light search requests +
// no detail fetches here, so it's far cheaper than a refresh. Backs up db.json
// first; stops on a block page.
//
// Usage: node backend/scripts/collect_cl.mjs

import fs from "node:fs";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "backend/data/db.json");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) => (s || "").replace(/&amp;/g, "&").replace(/&#x27;|&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#?\w+;/g, " ").trim();
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "+00:00");
const bedsFromTitle = (t) => {
  if (/studio/i.test(t)) return 0;
  const m = (t || "").match(/(\d+(?:\.\d+)?)\s*(?:br|bd|bed)/i);
  return m ? Number(m[1]) : null;
};

// Canonical SF neighborhood map (free-text CL location -> clean name), so new
// posts join the existing 45-name set instead of spawning new filter toggles.
// "" means the raw value carries no neighborhood signal. Unknown raw values fall
// back to the raw string.
const HOOD_MAP = {
  "SOMA / south beach": "SoMa", "tenderloin": "Tenderloin", "downtown / civic / van ness": "Civic Center",
  "nob hill": "Nob Hill", "city of san francisco": "", "pacific heights": "Pacific Heights",
  "ingleside / SFSU / CCSF": "Ingleside", "north beach / telegraph hill": "North Beach", "San Francisco": "",
  "marina / cow hollow": "Marina", "lower nob hill": "Lower Nob Hill", "hayes valley": "Hayes Valley",
  "richmond / seacliff": "Richmond", "Downtown": "Financial District", "sunset / parkside": "Sunset",
  "russian hill": "Russian Hill", "San Francisco, CA": "", "mission district": "Mission District",
  "inner sunset / UCSF": "Inner Sunset", "Nob Hill": "Nob Hill", "inner richmond": "Inner Richmond",
  "noe valley": "Noe Valley", "lower pac hts": "Lower Pacific Heights", "excelsior / outer mission": "Excelsior",
  "haight ashbury": "Haight-Ashbury", "laurel hts / presidio": "Presidio Heights", "alamo square / nopa": "NoPa",
  "bernal heights": "Bernal Heights", "bayview": "Bayview", "financial district": "Financial District",
  "Pacific Heights": "Pacific Heights", "lower haight": "Lower Haight", "Tenderloin": "Tenderloin",
  "western addition": "Western Addition", "cole valley / ashbury hts": "Cole Valley",
  "twin peaks / diamond hts": "Twin Peaks", "San franscisco": "", "glen park": "Glen Park",
  "Lower Pac Heights": "Lower Pacific Heights", "USF / panhandle": "Panhandle", "Lower Nob Hill": "Lower Nob Hill",
  "Mid-Market": "SoMa", "portola district": "Portola", "potrero hill": "Potrero Hill", "SoMa": "SoMa",
  "castro / upper market": "Castro", "san francisco": "", "Marina": "Marina", "visitacion valley": "Visitacion Valley",
  "North Waterfront": "North Beach", "Van Ness-Civic Center": "Civic Center", "Polk Gulch": "Polk Gulch",
  "Noe Valley": "Noe Valley", "Central Sunset": "Sunset", "Buena Vista": "Buena Vista",
  "Duboce Triangle": "Duboce Triangle", "west portal / forest hill": "West Portal",
  "Mission Bay and Dogpatch": "Mission Bay", "Marina District": "Marina", "Hayes Valley": "Hayes Valley",
  "Miraloma Park": "Miraloma Park", "Crocker Amazon": "Crocker Amazon", "Western Addition": "Western Addition",
  "Nopa": "NoPa", "Russian Hill": "Russian Hill", "Dolores Heights/Upper Mission": "Mission District",
  "SF Shipyard": "Bayview", "Inner Richmond / Presidio Heights": "Inner Richmond", "Outer Richmond": "Richmond",
  "Eureka Valley": "Eureka Valley", "San Francisco Parkside": "Parkside",
};
const normHood = (raw) => (raw in HOOD_MAP ? HOOD_MAP[raw] : raw || "");

const bands = [[0, 1800], [1800, 2300], [2300, 2700], [2700, 3100], [3100, 3600], [3600, 4200], [4200, 5000], [5000, 6500], [6500, 20000]];
const queries = bands.map(([lo, hi]) => `https://sfbay.craigslist.org/search/sfc/apa?sort=date&min_price=${lo}&max_price=${hi}`);

const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
const existingIds = new Set(db.listings.map((l) => l.id));
console.log(`db has ${db.listings.length} listings; scanning ${queries.length} price bands for new posts…`);

const found = new Map(); // pid -> card (new only)
let blocked = false;
for (const url of queries) {
  let html;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    html = await r.text();
  } catch (e) {
    console.log("query failed:", url.split("sfc/apa")[1], String(e.message));
    continue;
  }
  if (/request has been blocked|blockID/i.test(html)) { blocked = true; console.log("!! blocked — stopping"); break; }
  let geo = [];
  const ldm = html.match(/<script[^>]*id="ld_searchpage_results"[^>]*>([\s\S]*?)<\/script>/);
  if (ldm) try { geo = (JSON.parse(ldm[1]).itemListElement || []).map((e) => e.item || {}); } catch {}
  const olm = html.match(/<ol[^>]*cl-static-search-results[^>]*>([\s\S]*?)<\/ol>/);
  const cards = olm ? (olm[1].match(/<li class="cl-static-search-result"[\s\S]*?<\/li>/g) || []) : [];
  let isNew = 0;
  cards.forEach((li, i) => {
    const u = (li.match(/<a href="([^"]+)"/) || [])[1] || "";
    const pid = (u.match(/(\d+)\.html/) || [])[1];
    if (!u || !pid || existingIds.has(pid) || found.has(pid)) return;
    const g = geo[i] || {};
    found.set(pid, {
      pid, url: u,
      title: decode((li.match(/class="title">([^<]+)/) || [])[1]),
      location: decode((li.match(/class="location">([\s\S]*?)<\/div>/) || [])[1]),
      rent: (() => { const p = (li.match(/class="price">\$?([\d,]+)/) || [])[1]; return p ? Number(p.replace(/,/g, "")) : null; })(),
      lat: typeof g.latitude === "number" ? g.latitude : null,
      lng: typeof g.longitude === "number" ? g.longitude : null,
    });
    isNew++;
  });
  console.log(`${url.split("sfc/apa")[1]} -> ${cards.length} cards, +${isNew} new`);
  await sleep(600);
}

// in-SF bbox + must have geo (so the map/commute work)
const inSF = [...found.values()].filter((c) => c.lat >= 37.70 && c.lat <= 37.84 && c.lng >= -122.53 && c.lng <= -122.35);
console.log(`\nnew unique posts: ${found.size}; in-SF with geo: ${inSF.length}`);

if (inSF.length) {
  const bak = `backend/data/db.backup.collect-${Date.now()}.json`;
  fs.writeFileSync(bak, JSON.stringify(db, null, 2) + "\n");
  console.log(`backup -> ${bak}`);
  for (const c of inSF) {
    db.listings.push({
      id: c.pid, name: c.title || "(untitled)", address: "",
      neighborhood: normHood(c.location), neighborhood_raw: c.location,
      source: "Craigslist", url: c.url,
      rent: c.rent ?? null, sqft: null, beds: bedsFromTitle(c.title), baths: null,
      lat: c.lat, lng: c.lng, amenities: {}, highlights: "", photo_urls: [], tags: [],
      notes: "", status: "candidate",
      ratings: { you: {}, fiance: {} }, auto_scored: false,
      commute_minutes_manual: null, commute: null,
      listed_at: null, days_on_market: null,
      link_status: "live", // just seen in search results
      created_at: nowIso(), updated_at: nowIso(),
    });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + "\n");
  console.log(`added ${inSF.length} new listings (list-level). db now ${db.listings.length}.`);
  console.log(`NEXT: run refresh_listings.mjs --fresh-within 1  (enriches the new rows), then auto-score them.`);
} else {
  console.log("no new in-SF posts to add.");
}
if (blocked) console.log("(stopped early on a block — re-run when unblocked)");
