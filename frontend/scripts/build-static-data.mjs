// Bake the flat-file db.json into static JSON the frontend can fetch with no
// backend. Run before `vite build` in the static deploy (see `build:static`).
// Output lands in public/data/ so Vite copies it into dist/data/.
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const db = JSON.parse(fs.readFileSync(path.join(repoRoot, "backend/data/db.json"), "utf8"));

const outDir = path.resolve(process.cwd(), "public/data");
fs.mkdirSync(outDir, { recursive: true });

// listings.json: raw listings (the frontend computes scores client-side via scoring.ts).
fs.writeFileSync(path.join(outDir, "listings.json"), JSON.stringify(db.listings ?? []));
// settings.json: scoring weights, commute bands, anchor, defaults.
fs.writeFileSync(path.join(outDir, "settings.json"), JSON.stringify(db.settings ?? {}));
// tags.json: mirrors GET /tags ({ tags, categories }).
const categories = {};
for (const t of db.tags ?? []) (categories[t.category] ??= []).push(t.label);
fs.writeFileSync(path.join(outDir, "tags.json"), JSON.stringify({ tags: db.tags ?? [], categories }));

console.log(`baked static data: ${(db.listings ?? []).length} listings, ${(db.tags ?? []).length} tags -> public/data/`);
