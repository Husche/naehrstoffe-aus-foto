import { config } from "./config.js";

// Nährstoffe, die wir aus Open Food Facts extrahieren (pro 100 g / 100 ml).
// Schlüssel = OFF-Feldname, Wert = interner Spaltenname im CSV.
export const NUTRIENT_MAP = {
  "energy-kcal": "kcal",
  proteins: "protein_g",
  fat: "fat_g",
  carbohydrates: "carbs_g",
  sugars: "sugar_g",
  fiber: "fiber_g",
  salt: "salt_g",
  sodium: "sodium_mg",
  potassium: "potassium_mg",
  calcium: "calcium_mg",
  magnesium: "magnesium_mg",
  iron: "iron_mg",
  zinc: "zinc_mg",
  phosphorus: "phosphorus_mg",
  "vitamin-c": "vitamin_c_mg",
  "vitamin-a": "vitamin_a_mg",
  "vitamin-d": "vitamin_d_ug",
  "vitamin-e": "vitamin_e_mg",
  "vitamin-b1": "vitamin_b1_mg",
  "vitamin-b2": "vitamin_b2_mg",
  "vitamin-b6": "vitamin_b6_mg",
  "vitamin-b12": "vitamin_b12_ug",
  "vitamin-pp": "niacin_mg",
  "vitamin-k": "vitamin_k_ug",
  folate: "folate_ug",
  cholesterol: "cholesterol_mg",
  "saturated-fat": "sat_fat_g",
  "trans-fat": "trans_fat_g",
};

export const NUTRIENT_COLUMNS = [
  "kcal",
  "protein_g",
  "fat_g",
  "sat_fat_g",
  "trans_fat_g",
  "carbs_g",
  "sugar_g",
  "fiber_g",
  "salt_g",
  "sodium_mg",
  "potassium_mg",
  "calcium_mg",
  "magnesium_mg",
  "iron_mg",
  "zinc_mg",
  "phosphorus_mg",
  "vitamin_a_mg",
  "vitamin_c_mg",
  "vitamin_d_ug",
  "vitamin_e_mg",
  "vitamin_b1_mg",
  "vitamin_b2_mg",
  "vitamin_b6_mg",
  "vitamin_b12_ug",
  "niacin_mg",
  "vitamin_k_ug",
  "folate_ug",
  "cholesterol_mg",
];

// Einfaches LRU-Caching mit Begrenzung gegen unendliches Speicherwachstum.
const CACHE_MAX = 200;
const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key);
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key, val) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, val);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export async function fetchNutrients(foodName) {
  const key = foodName.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${config.nutrition.baseUrl}/cgi/search.pl?search_terms=${encodeURIComponent(
    foodName
  )}&search_simple=1&action=process&json=1&page_size=10&fields=product_name,code,nutriments`;

  let product = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": "NaehrstoffFoto/1.0 (self-hosted)" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      const products = data.products || [];
      product = pickBest(products, key);
    }
  } catch (e) {
    console.warn("OFF Fetch Fehler:", e.message);
  }

  const result = extractNutrients(product);
  cacheSet(key, result);
  return result;
}

function pickBest(products, query) {
  if (!products.length) return null;
  const q = query.toLowerCase();
  let best = null;
  let bestScore = -1;
  for (const p of products) {
    let score = 0;
    const n = p.nutriments || {};
    // Datenqualität: komplette Makros am wichtigsten.
    if (n["energy-kcal_100g"] != null) score += 5;
    if (n.proteins_100g != null) score += 3;
    if (n.carbohydrates_100g != null) score += 3;
    if (n.fat_100g != null) score += 3;
    if (n.fiber_100g != null) score += 2;
    // Namensübereinstimmung als starkes Signal.
    const name = (p.product_name || "").toLowerCase();
    if (name === q) score += 10;
    else if (name.startsWith(q)) score += 7;
    else if (name.includes(q)) score += 5;
    else if (q.includes(name) && name.length > 2) score += 3;
    // Bevorzuge deutsche Produkte (bessere Treffer für deutsche Lebensmittelnamen).
    if (p.countries_tags && p.countries_tags.includes("en:germany")) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function extractNutrients(product) {
  const base = {};
  for (const c of NUTRIENT_COLUMNS) base[c] = 0;
  base.source = "none";
  if (!product) return base;

  const n = product.nutriments || {};
  for (const [offKey, ourKey] of Object.entries(NUTRIENT_MAP)) {
    const val = n[`${offKey}_100g`] ?? n[offKey] ?? n[`${offKey}value_100g`];
    if (val != null && !Number.isNaN(Number(val))) {
      base[ourKey] = Number(val);
    }
  }
  // Fallback: kcal aus kJ ableiten (1 kcal = 4.184 kJ), falls nur Joule geliefert.
  if ((!base.kcal || base.kcal === 0) && (n["energy-kj_100g"] || n.energy_kj_100g)) {
    base.kcal = Math.round((Number(n["energy-kj_100g"] ?? n.energy_kj_100g)) / 4.184);
  }
  base.source = product.product_name || product.code || "openfoodfacts";
  return base;
}

export function scaleNutrients(per100, grams) {
  const factor = Math.max(0, Number(grams) || 0) / 100;
  const out = {};
  for (const c of NUTRIENT_COLUMNS) {
    out[c] = round2((per100[c] || 0) * factor);
  }
  return out;
}

// Parallelisierte Nährstoffabfrage für mehrere Lebensmittel.
export async function fetchNutrientsBatch(foodNames) {
  return Promise.all(foodNames.map((n) => fetchNutrients(n)));
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
