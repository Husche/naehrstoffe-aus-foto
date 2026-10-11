import { config } from "./config.js";
import { estimateNutrients } from "./mistral.js";

// Eingebaute Nährwerte pro 100 g (fest) / 100 ml (Getränk) für die häufigsten
// frischen bzw. zubereiteten Grundnahrungsmittel. Diese existieren in Open
// Food Facts (Fertigprodukt-Datenbank) kaum oder nur mit schlechten Treffern
// und sind hier verlässlicher hinterlegt. Keys kleingeschrieben, Lookup
// über exakten Match, dann Teilstring-Match.
export const BUILTIN_FOODS = {
  "reis gekocht": [130, 2.7, 0.3, 0.1, 0, 28, 0.1, 0.4, 0.01, 5, 35, 10, 12, 0.2, 0.5, 43, 0, 0, 0, 0, 0.01, 0.01, 0.05, 0, 0.4, 0, 10, 0],
  "nudeln gekocht": [158, 5.8, 0.9, 0.2, 0, 31, 0.6, 1.8, 0.01, 5, 44, 7, 18, 1.3, 0.5, 58, 0, 0, 0, 0, 0.03, 0.02, 0.05, 0, 1.2, 0, 7, 0],
  "kartoffeln gekocht": [87, 2, 0.1, 0, 0, 20, 0.9, 1.8, 0.01, 5, 328, 6, 20, 0.3, 0.3, 40, 0, 13, 0, 0.01, 0.08, 0.02, 0.3, 0, 1.4, 10, 0, 0],
  "gegrillte hähnchenbrust": [165, 31, 3.6, 1, 0, 0, 0, 0, 0.25, 90, 256, 15, 29, 1, 0.7, 200, 0.01, 0, 0.1, 0.3, 0.07, 0.1, 0.6, 0.3, 13.7, 0, 4, 85],
  "rindersteak": [201, 27, 10, 4, 0, 0, 0, 0, 0.3, 110, 318, 12, 21, 2.6, 4.5, 180, 0, 0, 0.1, 0.4, 0.05, 0.2, 0.5, 1.2, 3.9, 0, 5, 70],
  "schweineschnitzel gebraten": [240, 27, 14, 5, 0, 0, 0, 0, 0.3, 120, 280, 14, 22, 0.9, 2.3, 200, 0, 0, 0.1, 0.2, 0.5, 0.2, 0.5, 0.6, 5, 0, 3, 80],
  "lachs gebraten": [208, 20, 13, 3.1, 0, 0, 0, 0, 0.15, 60, 363, 12, 29, 0.34, 0.4, 200, 0.012, 0, 3.5, 2, 0.23, 0.13, 0.5, 5, 7, 0.5, 25, 55],
  "gegrillte putenbrust": [172, 21, 9, 3, 0, 0, 0, 0, 0.18, 72, 322, 10, 25, 0.8, 1.1, 160, 0.03, 0, 0.9, 0.6, 0.05, 0.12, 0.45, 0.3, 6.8, 0, 5, 63],
  "ei gekocht": [155, 13, 11, 3.3, 0, 1.1, 1.1, 0, 0.35, 124, 126, 50, 10, 1.2, 1.3, 172, 0.08, 0, 2, 1, 0.04, 0.46, 0.12, 1.1, 0.05, 47, 373],
  "haferflocken": [372, 13, 7, 1.2, 0, 59, 0.5, 10, 0.01, 6, 359, 54, 138, 4.4, 3.3, 410, 0, 0, 0, 0.4, 0.46, 0.16, 0.1, 0.9, 0.96, 0, 32, 0],
  "mischbrot": [250, 8.5, 3.2, 0.6, 0, 47, 2.5, 5.5, 1.2, 480, 200, 40, 60, 2.2, 1.4, 130, 0.005, 0, 0, 0.5, 0.28, 0.14, 0.2, 0, 3.3, 0, 30, 0],
  "brat-kartoffeln": [132, 2.3, 4.5, 0.6, 0, 20, 0.8, 1.8, 0.02, 8, 350, 8, 18, 0.4, 0.3, 45, 0, 10, 0, 0.05, 0.08, 0.02, 0.28, 0, 1.3, 8, 0, 0],
  "milchreis": [128, 3.8, 2.5, 1.4, 0, 21, 11, 0.2, 0.08, 40, 110, 100, 12, 0.1, 0.4, 80, 0.015, 0.4, 0.1, 0.01, 0.04, 0.18, 0.04, 0.4, 0.7, 5, 10, 10],
  "joghurt natur": [62, 3.5, 3.3, 2.1, 0, 4.7, 4.7, 0, 0.08, 46, 156, 121, 12, 0.05, 0.4, 93, 0.004, 0.5, 0.06, 0.02, 0.02, 0.14, 0.02, 0.2, 0.4, 0, 7, 10],
  "goudakäse": [356, 25, 28, 17.6, 0, 0, 0, 0, 1.6, 819, 121, 700, 25, 0.2, 3.9, 546, 0.17, 0, 0.24, 0.8, 0.03, 0.33, 0.08, 1.1, 0.4, 60, 105],
  "mozzarella": [280, 22, 21, 13, 0, 1, 0.5, 0, 0.5, 480, 76, 400, 15, 0.1, 2.2, 340, 0.14, 0, 0.2, 0.5, 0.02, 0.2, 0.05, 0.9, 0.2, 15, 50, 60],
  "butter": [741, 0.9, 82, 52, 0, 0.7, 0.7, 0, 0.02, 11, 24, 24, 2, 0, 0.1, 24, 0.68, 0, 1.5, 2.3, 0, 0, 0, 0.2, 0.1, 7, 190],
  "olivenöl": [884, 0, 100, 13.8, 0, 0, 0, 0, 0, 2, 1, 1, 0, 0.4, 0, 0, 0, 0, 0, 14, 0, 0, 0, 0, 0, 0, 0, 0],
  "tomatensalat": [24, 0.9, 0.2, 0, 0, 5, 4, 1.2, 0.03, 8, 204, 13, 9, 0.4, 0.1, 23, 0.04, 14, 0, 0.6, 0.04, 0.02, 0.08, 0, 0.6, 9, 0, 0],
  "grüner salat": [15, 1.4, 0.2, 0, 0, 2.4, 0.8, 1.3, 0.03, 10, 194, 18, 7, 0.7, 0.1, 20, 0.19, 4, 0, 0.3, 0.05, 0.03, 0.05, 0, 0.35, 38, 0, 0],
  "humus": [166, 7.9, 9.6, 1.4, 0, 14.3, 0.3, 6, 0.6, 379, 400, 38, 71, 2.4, 1.1, 176, 0.01, 0, 0, 1, 0.18, 0.06, 0.1, 0, 0.6, 44, 0, 0],
  "kartoffelgratin": [128, 4.5, 7.5, 4.5, 0, 11, 1.5, 1.2, 0.4, 150, 320, 80, 15, 0.5, 0.5, 100, 0.05, 8, 0.1, 0.3, 0.06, 0.05, 0.1, 0.2, 0.8, 8, 20, 20],
  "pizza margherita": [224, 9.4, 8.3, 3.5, 0, 28, 3.1, 2.1, 1.2, 480, 184, 190, 22, 1.8, 0.9, 180, 0.04, 1, 0.1, 0.4, 0.15, 0.1, 0.07, 0.2, 1.8, 30, 15, 15],
  "spaghetti bolognese": [132, 6.5, 4.2, 1.8, 0, 15.5, 2.8, 1.4, 0.5, 210, 250, 30, 20, 1.1, 1, 80, 0.03, 3, 0.1, 0.4, 0.07, 0.06, 0.1, 0.4, 1.4, 12, 15, 18],
  "wassermelone": [30, 0.6, 0.2, 0, 0, 7.6, 6.2, 0.4, 0.01, 1, 112, 7, 10, 0.2, 0.1, 11, 0.03, 8, 0, 0.1, 0.03, 0.02, 0.05, 0, 0.2, 3, 0, 0],
  "banane": [89, 1.1, 0.3, 0.1, 0, 22.8, 12.2, 2.6, 0.01, 1, 358, 5, 27, 0.3, 0.2, 22, 0.003, 8.7, 0, 0.1, 0.03, 0.07, 0.37, 0, 0.7, 20, 0, 0],
  "apfel": [52, 0.3, 0.2, 0, 0, 13.8, 10.4, 2.4, 0, 1, 107, 6, 5, 0.1, 0, 11, 0.003, 4.6, 0, 0.2, 0.02, 0.03, 0.04, 0, 0.1, 3, 0, 0],
  "wasser": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const BUILTIN_KEYS = Object.keys(BUILTIN_FOODS).sort((a, b) => b.length - a.length);

function lookupBuiltin(name) {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return null;
  for (const key of BUILTIN_KEYS) {
    if (n === key || n.includes(key)) {
      return buildResult(BUILTIN_FOODS[key], "builtin");
    }
  }
  return null;
}

function buildResult(values, source) {
  const out = {};
  NUTRIENT_COLUMNS.forEach((c, i) => (out[c] = Number(values[i]) || 0));
  out.source = source;
  return out;
}


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

export async function fetchNutrients(foodName, category = "", searchName = "") {
  const key = foodName.toLowerCase().trim();
  const cached = cacheGet(key);
  if (cached) return cached;

  const builtin = lookupBuiltin(foodName);
  if (builtin) {
    console.log(`OFF-Skip "${foodName}": eingebaute Nährwerte (${builtin.source})`);
    cacheSet(key, builtin);
    return builtin;
  }

  const offQuery = (searchName || foodName).trim();
  const url = `${config.nutrition.baseUrl}/cgi/search.pl?search_terms=${encodeURIComponent(
    offQuery
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
  if (result.source !== "none") {
    console.log(
      `OFF-Treffer "${foodName}" (Suche: "${offQuery}") -> "${result.source}"`
    );
  }
  // Fallback auf Mistral-Schätzung, wenn OFF keinen Treffer lieferte oder
  // der Treffer keine Kern-Makros enthält (z. B. unvollständige OFF-Einträge
  // für türkische Speisen). Schlägt der Fallback fehl, bleiben die 0-Werte.
  const coreEmpty = !(result.kcal || result.protein_g || result.fat_g || result.carbs_g);
  if (result.source === "none" || coreEmpty) {
    const est = await estimateNutrients(foodName, category).catch(() => null);
    if (est) {
      for (const col of NUTRIENT_COLUMNS) {
        if (est[col] != null) result[col] = Number(est[col]) || 0;
      }
      result.source = "mistral-estimate";
      console.log(`Mistral-Fallback für "${foodName}" (kein brauchbarer OFF-Treffer)`);
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
export async function fetchNutrientsBatch(foodNames, categories, searchNames) {
  const results = new Array(foodNames.length);
  let cursor = 0;
  async function worker() {
    while (cursor < foodNames.length) {
      const i = cursor++;
      results[i] = await fetchNutrients(
        foodNames[i],
        categories && categories[i],
        searchNames && searchNames[i]
      );
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
