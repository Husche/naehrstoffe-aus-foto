import type { Meal } from "./types.ts";

const DB_NAME = "naehrstoff-foto";
const DB_VERSION = 1;
const STORE = "meals";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "meal_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveMeal(meal: Meal): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(meal);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllMeals(): Promise<Meal[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Meal[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteMeal(meal_id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(meal_id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Nur ungesyncerte Mahlzeiten via Cursor-Filter statt getAll + filter.
export async function getUnsyncedMeals(): Promise<Meal[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    const result: Meal[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const meal = cursor.value as Meal;
        if (!meal.synced) result.push(meal);
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

// Direktes Update des synced-Flags ohne get+put.
export async function markSynced(meal_id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(meal_id);
    getReq.onsuccess = () => {
      const meal = getReq.result as Meal | undefined;
      if (meal) {
        meal.synced = true;
        store.put(meal);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
