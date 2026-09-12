import { config } from "./config.js";
import { estimateNutrients } from "./mistral.js";

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

const RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 800;

export async function fetchNutrients(foodName, category = "") {
  const key = foodName.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${config.nutrition.baseUrl}/cgi/search.pl?search_terms=${encodeURIComponent(
    foodName
  )}&search_simple=1&action=process&json=1&page_size=10&fields=product_name,code,nutriments`;

  let product = null;
  let success = false;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "NaehrstoffFoto/1.0 (self-hosted)" },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const products = data.products || [];
        product = pickBest(products, key);
        success = true;
        break;
      }
      // 4xx: kein Retry (z. B. 400/404), direkt abbrechen.
      if (res.status >= 400 && res.status < 500) {
        console.warn(`OFF Fetch ${res.status} fuer "${foodName}" (kein Retry)`);
        break;
      }
      // 5xx (z. B. 503 Service Temporarily Unavailable): retry mit Backoff.
      console.warn(`OFF Fetch ${res.status} fuer "${foodName}" (Versuch ${attempt}/${RETRY_ATTEMPTS})`);
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt + jitter());
    } catch (e) {
      console.warn(`OFF Fetch Fehler fuer "${foodName}" (Versuch ${attempt}/${RETRY_ATTEMPTS}):`, e.message);
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_BACKOFF_MS * attempt + jitter());
    } finally {
      clearTimeout(timeout);
    }
  }

  const result = extractNutrients(product);
  // Fallback auf Mistral-Schätzung, wenn OFF keinen Treffer lieferte.
  // Liefert realistische Schätzungen für Lebensmittel, die nicht auf OFF
  // hinterlegt sind (z. B. türkische Speisen, hausgemachte Soßen). Schlägt
  // der Fallback fehl, bleiben die 0-Werte erhalten.
  if (result.source === "none") {
    const est = await estimateNutrients(foodName, category).catch(() => null);
    if (est) {
      for (const col of NUTRIENT_COLUMNS) {
        if (est[col] != null) result[col] = Number(est[col]) || 0;
      }
      result.source = "mistral-estimate";
    }
  }
  // Nur erfolgreiche Treffer cachen. Fehler (z. B. 503/Netzwerk) nicht
  // festhalten, sonst liefert jeder weitere Versuch denselben leeren Treffer
  // bis zum Prozessneustart.
  if (success || result.source === "mistral-estimate") cacheSet(key, result);
  return result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Kleiner Zufalls-Jitter (0-200 ms), um synchronisierte Retries
// (Thundering Herd) bei mehreren gleichzeitigen Lookups zu glätten.
function jitter() {
  return Math.floor(Math.random() * 200);
}

// Hinweise, dass ein OFF-Produkt verarbeitet ist (Saft, Püree, Sirup, ...).
// Bei einem frischen Lebensmittel-Namen (z. B. "Apfel") sollen diese Treffer
// abgewertet werden, damit nicht "Apfel naturtrüb Direktsaft" gewinnt.
const PROCESSED_HINTS = [
  "saft", "juice", "direktsaft", "sirup", "nektar", "püree", "pueree",
  "mark", "mus", "getränk", "drink", "konfitüre", "marmelade", "gelee",
  "chips", "trocken", "pulver", "smoothie", "kompott",
];

function isProcessedName(name) {
  const n = (name || "").toLowerCase();
  return PROCESSED_HINTS.some((h) => n.includes(h));
}

function pickBest(products, query) {
  if (!products.length) return null;
  const q = query.toLowerCase();
  const queryProcessed = isProcessedName(q);
  let best = null;
  let bestScore = -Infinity;
  for (const p of products) {
    const n = p.nutriments || {};
    const name = (p.product_name || "").toLowerCase();
    let score = 0;
    // Namensübereinstimmung als stärkstes Signal (vor Datenqualität), damit
    // der Name stimmt, bevor Sekundärkriterien entscheiden.
    if (name === q) score += 20;
    else if (name.startsWith(q)) score += 14;
    else if (q.startsWith(name) && name.length > 2) score += 10;
    else if (name.includes(q)) score += 8;
    else if (q.includes(name) && name.length > 2) score += 4;
    else score -= 4; // Name passt gar nicht -> abwerten.
    // Verarbeitungs-Mismatch bestrafen: Query frisch, Produkt verarbeitet
    // (z. B. "Apfel" vs. "Apfel naturtrüb Direktsaft") -> stark abwerten.
    if (!queryProcessed && isProcessedName(name)) score -= 15;
    // Datenqualität: komplette Makros am wichtigsten (sekundär).
    if (n["energy-kcal_100g"] != null) score += 5;
    if (n.proteins_100g != null) score += 3;
    if (n.carbohydrates_100g != null) score += 3;
    if (n.fat_100g != null) score += 3;
    if (n.fiber_100g != null) score += 2;
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

// Maximale Anzahl paralleler OFF-Requests, um Backend + OFF bei Mahlzeiten
// mit vielen Items oder bösartigen Inputs (viele Namen) nicht zu überlasten.
const BATCH_CONCURRENCY = 5;

// Parallelisierte Nährstoffabfrage für mehrere Lebensmittel mit begrenzter
// Konkurrenz, damit nicht Dutzende OFF-Requests gleichzeitig feuern.
export async function fetchNutrientsBatch(foodNames, categories) {
  const results = new Array(foodNames.length);
  let cursor = 0;
  async function worker() {
    while (cursor < foodNames.length) {
      const i = cursor++;
      results[i] = await fetchNutrients(foodNames[i], categories && categories[i]);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(BATCH_CONCURRENCY, foodNames.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
