import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Bitte setze SUPABASE_URL und SUPABASE_ANON_KEY als Umgebungsvariablen.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function slug(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .slice(0, 50);
}

function normalizeRounds(raw) {
  // akzeptiert:
  // A) [{...}, {...}]
  // B) { "<category>": [{...}], "<category2>": [{...}] }
  // C) { rounds: [...] }
  if (Array.isArray(raw)) return raw.map(r => ({ __categoryFromKey: null, ...r }));
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.rounds)) return raw.rounds.map(r => ({ __categoryFromKey: null, ...r }));
    // Objekt nach Kategorien
    const out = [];
    for (const [cat, arr] of Object.entries(raw)) {
      if (Array.isArray(arr)) {
        for (const r of arr) out.push({ __categoryFromKey: cat, ...r });
      }
    }
    return out;
  }
  return [];
}

const filePath = path.resolve(process.cwd(), "rounds.json");
if (!fs.existsSync(filePath)) {
  console.error("❌ rounds.json nicht gefunden im Ordner:", process.cwd());
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
const rounds = normalizeRounds(raw);

if (!rounds.length) {
  console.error("❌ Konnte keine Runden aus rounds.json erkennen (Format unerwartet).");
  process.exit(1);
}

// Mappe auf DB-Schema: (id, category, name, data)
const rows = rounds.map((r, i) => {
  const category =
    r.category ??
    r.gameType ??
    r.type ??
    r.__categoryFromKey ??
    "unknown";

  const name =
    r.name ??
    r.title ??
    r.roundName ??
    r.id ??
    `${category} #${i + 1}`;

  // Wenn keine id vorhanden ist, generieren wir eine stabile (aber: besser ist eine echte id aus deinem System)
  const id =
    r.id ??
    `${slug(category)}-${slug(name)}-${i + 1}`;

  // data = kompletter Round-Block (ohne das interne Feld)
  const { __categoryFromKey, ...data } = r;

  return { id: String(id), category: String(category), name: String(name), data };
});

// Batching (Supabase mag keine riesigen Inserts)
async function upsertInBatches(batchSize = 200) {
  let ok = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("rounds")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      console.error("❌ Fehler beim Upsert (Batch ab Index", i, "):", error);
      process.exit(1);
    }
    ok += batch.length;
    console.log(`✅ Upsert ok: ${ok}/${rows.length}`);
  }
  console.log("🎉 Fertig. Insgesamt:", ok);
}

await upsertInBatches();
