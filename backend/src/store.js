// Einfache serverseitige Persistenz als JSON-Datei (für Multi-Gerät-Sync).
// Single-User, self-hosted: Datei-basiert reicht aus, keine DB nötig.
// Mahlzeiten werden unter ./data/meals.json gespeichert.
//
// Nebenläufigkeit: readDb -> writeDb ist nicht atomar. Bei gleichzeitigem
// Schreiben zweier Requests gewinnt der letzte. Für 2-3 Fotos/Tag des Single-Users
// vertretbar; bei höherer Last wäre eine echte DB oder File-Locking nötig.

import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "meals.json");
// Schutz gegen ungebremstes Wachstum der JSON-Datei (self-hosted, Single-User).
const MAX_MEALS = 5000;
const MAX_ITEM_NAME = 200;

async function ensureDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    /* existiert bereits */
  }
}

async function readDb() {
  await ensureDir();
  try {
    const raw = await fs.readFile(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { meals: [] };
  }
}

async function writeDb(db) {
  await ensureDir();
  // Atomar: temporäre Datei, dann umbenennen.
  const tmp = DB_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(db), "utf-8");
  await fs.rename(tmp, DB_FILE);
}

// Bereinigt ein eingehendes Meal-Objekt (Server-seitige Validierung).
// Verhindert, dass beliebige Felder/Größen die Persistenz verunreinigen.
function sanitizeMeal(meal) {
  const meal_id = String(meal?.meal_id || "").slice(0, 100);
  const timestamp = String(meal?.timestamp || new Date().toISOString()).slice(0, 40);
  const beer_flag = !!meal?.beer_flag;
  const synced = !!meal?.synced;
  const sanity_issues = Array.isArray(meal?.sanity_issues)
    ? meal.sanity_issues.slice(0, 50).map((s) => String(s).slice(0, 300))
    : [];
  const rawItems = Array.isArray(meal?.items) ? meal.items.slice(0, 100) : [];
  const items = rawItems.map((it) => ({
    name: String(it?.name || "").slice(0, MAX_ITEM_NAME),
    category: String(it?.category || "Sonstiges").slice(0, 50),
    portion_g: Math.max(0, Math.min(2500, Number(it?.portion_g) || 0)),
    is_beer: !!it?.is_beer,
    source: String(it?.source || "").slice(0, 100),
  }));
  return { meal_id, timestamp, items, beer_flag, synced, sanity_issues };
}

export async function storeGetMeals() {
  const db = await readDb();
  return db.meals || [];
}

export async function storeGetMeal(meal_id) {
  const id = String(meal_id || "").slice(0, 100);
  const db = await readDb();
  return (db.meals || []).find((m) => m.meal_id === id) || null;
}

export async function storeUpsertMeal(meal) {
  const db = await readDb();
  const meals = db.meals || [];
  const clean = sanitizeMeal(meal);
  if (!clean.meal_id) throw new Error("Ungültige meal_id.");
  const idx = meals.findIndex((m) => m.meal_id === clean.meal_id);
  if (idx >= 0) meals[idx] = clean;
  else {
    if (meals.length >= MAX_MEALS) meals.shift();
    meals.push(clean);
  }
  await writeDb({ ...db, meals });
  return clean;
}

export async function storeDeleteMeal(meal_id) {
  const id = String(meal_id || "").slice(0, 100);
  const db = await readDb();
  const meals = (db.meals || []).filter((m) => m.meal_id !== id);
  await writeDb({ ...db, meals });
  return true;
}
