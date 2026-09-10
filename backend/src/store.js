// Einfache serverseitige Persistenz als JSON-Datei (für Multi-Gerät-Sync).
// Single-User, self-hosted: Datei-basiert reicht aus, keine DB nötig.
// Mahlzeiten werden unter ./data/meals.json gespeichert.

import fs from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "meals.json");

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
  await fs.writeFile(tmp, JSON.stringify(db, null, 0), "utf-8");
  await fs.rename(tmp, DB_FILE);
}

export async function storeGetMeals() {
  const db = await readDb();
  return db.meals || [];
}

export async function storeGetMeal(meal_id) {
  const db = await readDb();
  return (db.meals || []).find((m) => m.meal_id === meal_id) || null;
}

export async function storeUpsertMeal(meal) {
  const db = await readDb();
  const meals = db.meals || [];
  const idx = meals.findIndex((m) => m.meal_id === meal.meal_id);
  if (idx >= 0) meals[idx] = meal;
  else meals.push(meal);
  await writeDb({ ...db, meals });
  return meal;
}

export async function storeDeleteMeal(meal_id) {
  const db = await readDb();
  const meals = (db.meals || []).filter((m) => m.meal_id !== meal_id);
  await writeDb({ ...db, meals });
  return true;
}
