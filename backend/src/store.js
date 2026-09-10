// Einfache serverseitige Persistenz als JSON-Datei (für Multi-Gerät-Sync).
// Single-User, self-hosted: Datei-basiert reicht aus, keine DB nötig.
// Mahlzeiten werden unter ./data/meals.json gespeichert.
//
// Nebenläufigkeit: readDb -> writeDb ist nicht atomar. Bei gleichzeitigem
// Schreiben zweier Requests gewinnt der letzte. Für 2-3 Fotos/Tag des Single-Users
// vertretbar; bei höherer Last wäre eine echte DB oder File-Locking nötig.

import fs from "node:fs/promises";
import path from "node:path";
import { NUTRIENT_COLUMNS } from "./nutrition.js";

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

// Begrenzt einen numerischen Nährwert auf [0, grooving], defensiv gegen
// manipulierte/fehlerhafte Eingaben. Negative Werte werden auf 0 gesetzt.
function clampNum(v, max = 1e6) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, n);
}

// Bereinigt ein eingehendes Meal-Objekt (Server-seitige Validierung).
// Übernimmt die bekannten Nährstoff-Felder (NUTRIENT_COLUMNS) als numerisch
// geclampte Werte und verwirft unbekannte Felder. Verhindert sowohl
// Datenverlust der Nährwerte als auch das Verunreinigen der Persistenz.
function sanitizeMeal(meal) {
  const meal_id = String(meal?.meal_id || "").slice(0, 100);
  const timestamp = String(meal?.timestamp || new Date().toISOString()).slice(0, 40);
  const beer_flag = !!meal?.beer_flag;
  const synced = !!meal?.synced;
  const sanity_issues = Array.isArray(meal?.sanity_issues)
    ? meal.sanity_issues.slice(0, 50).map((s) => String(s).slice(0, 300))
    : [];
  const rawItems = Array.isArray(meal?.items) ? meal.items.slice(0, 100) : [];
  const items = rawItems.map((it) => {
    const item = {
      name: String(it?.name || "").slice(0, MAX_ITEM_NAME),
      category: String(it?.category || "Sonstiges").slice(0, 50),
      portion_g: Math.max(0, Math.min(2500, Number(it?.portion_g) || 0)),
      is_beer: !!it?.is_beer,
      source: String(it?.source || "").slice(0, 100),
    };
    // Alle bekannten Nährstoff-Felder numerisch übernehmen (Clamp auf >= 0),
    // damit die Multi-Gerät-Sync und der CSV-Export die Werte nicht verlieren.
    for (const col of NUTRIENT_COLUMNS) {
      item[col] = clampNum(it?.[col]);
    }
    // per100-Referenz (für clientseitiges Rescaling) sanitized übernehmen.
    if (it?.per100 && typeof it.per100 === "object") {
      const per100 = {};
      for (const col of NUTRIENT_COLUMNS) per100[col] = clampNum(it.per100[col]);
      per100.source = String(it.per100.source || "").slice(0, 100);
      item.per100 = per100;
    }
    return item;
  });
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
