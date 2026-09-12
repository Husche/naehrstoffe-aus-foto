import { config } from "./config.js";

export const FOOD_PROMPT = `Identifiziere alle Lebensmittel und Getränke auf diesem Teller/in diesem Glas.
Nutze sichtbare Farbe, Form, Oberfläche und Textur zur Erkennung. Achte besonders auf Unterschiede ähnlicher Lebensmittel (z. B. Avocado vs. Wassermelone, Mandeln vs. Datteln).
Für feste Lebensmittel: Name (auf Deutsch), eine grobe Kategorie (z. B. Getreide, Gemüse, Fleisch, Obst, Milchprodukt, Soße, Backware, Gebäck) und eine geschätzte Portionsgröße in Gramm anhand der sichtbaren Menge.
Für Getränke (Wasser, Wein, Saft, Bier, Tee, Kaffee, Limonade, etc.): Name (auf Deutsch), geschätzte Menge in Millilitern als "portion_ml" und Kategorie "Getränk".
Benenne Getränke nach der erkennbaren Flüssigkeit, nicht nach dem Gefäß – z. B. "Wasser", "Rotwein", "Weißwein", "Orangensaft", "Bier", "Tee", "Kaffee". Verwende nicht "Getränk" als Name.
Schätze die Portionsgröße anhand erkennbarer Gefäß-/Tellergröße. Vermeide pauschal 200 g/ml.
Antworte AUSSCHLIESSLICH als JSON-Objekt im folgenden Format, kein Markdown, keine Erklärungen:
{"items":[{"name":"Reis","portion_g":180,"category":"Getreide"},{"name":"Wasser","portion_ml":200,"category":"Getränk"}]}`;

export const PORTION_REFERENCES = {
  reis: 180, nudeln: 180, pasta: 180, kartoffeln: 220, pommes: 180, gemuese: 160, gemuesebeilage: 125, salatbeilage: 100, fleisch: 150, fisch: 150, soße: 50, sosse: 50, sauce: 50, hollandaise: 60, rahmsoße: 60, dip: 80, cacik: 80, haydari: 80, hummus: 80, lahmacun: 175, doener: 300, döner: 300, durüm: 300, dueruem: 300, pide: 250, köfte: 150, kofte: 150, börek: 100, borek: 100, adana: 175, brötchen: 50, broetchen: 50, croissant: 70, brezel: 100, kuchen: 100, torte: 100, simit: 90, brot: 100,
};

export function applyPortionReference(item) {
  if (!item || !Number.isFinite(item.portion_g) || item.portion_g <= 0) return item;
  const refDefault = item.is_beer || /getränk|drink/i.test(item.category || "") ? 200 : 100;
  if (item.portion_g !== refDefault) return item;
  const key = String(item.name || "").toLowerCase().trim();
  const ref = PORTION_REFERENCES[key];
  if (Number.isFinite(ref) && ref > 0) {
    return { ...item, portion_g: ref };
  }
  return item;
}

export const NUTRIENT_PROMPT = `Schätze die durchschnittlichen Nährwerte pro 100 g (bzw. 100 ml bei Getränken) für das angegebene Lebensmittel. Nenne Werte für Erwachsene, gerundet auf realistische Werte. Antworte AUSSCHLIESSLICH als JSON-Objekt mit exakt diesen Schlüsseln, kein Markdown:
{"kcal":0,"protein_g":0,"fat_g":0,"sat_fat_g":0,"trans_fat_g":0,"carbs_g":0,"sugar_g":0,"fiber_g":0,"salt_g":0,"sodium_mg":0,"potassium_mg":0,"calcium_mg":0,"magnesium_mg":0,"iron_mg":0,"zinc_mg":0,"phosphorus_mg":0,"vitamin_a_mg":0,"vitamin_c_mg":0,"vitamin_d_ug":0,"vitamin_e_mg":0,"vitamin_b1_mg":0,"vitamin_b2_mg":0,"vitamin_b6_mg":0,"vitamin_b12_ug":0,"niacin_mg":0,"vitamin_k_ug":0,"folate_ug":0,"cholesterol_mg":0}`;

export async function detectFood(imageBase64, mimeType = "image/jpeg") {
  if (!config.mistral.apiKey) {
    throw new Error(
      "MISTRAL_API_KEY fehlt. Bitte .env konfigurieren (siehe .env.example)."
    );
  }

  const body = {
    model: config.mistral.model,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: FOOD_PROMPT },
          {
            type: "image_url",
            image_url: `data:${mimeType};base64,${imageBase64}`,
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let res;
  try {
    res = await fetch(config.mistral.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.mistral.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mistral API Fehler ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Mistral: leere Antwort");
  }

  // Mistral liefert bei json_object-Format oft {"items": [...]} oder direkt ein Array als String.
  const parsed = safeParseJson(content);
  if (!parsed) {
    throw new Error("Mistral: Antwort nicht als JSON parsierbar");
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed.items || parsed.foods || parsed.results || [];
  return items.map(normalizeItem).filter(Boolean).map(applyPortionReference);
}

const BEER_RE = /bier\b|\bbeer\b|\bpils\b|weizenbier\b|altbier\b|\bkölsch\b|rauchbier\b/i;
const BEER_FOOD_RE = /brot|bröt|semmel|kuchen|suppe|soße|sauce|salat|mus|brei|hefe|käse|marinade|braten|glas|fladen/i;
const BEVERAGE_NAME_RE = /wasser|wein|saft|bier\b|tee|kaffee|limonade|cola|brause|most|sekt|schorle|cider|schnaps|likör|spirituose/i;
const BEVERAGE_FOOD_RE = /brot|bröt|semmel|kuchen|suppe|soße|sauce|salat|mus|brei|hefe|käse|marinade|braten|glas|fladen/i;

export function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || raw.lebensmittel || "").trim();
  if (!name) return null;
  const category = String(raw.category || raw.kategorie || "Sonstiges").trim();
  const portionG = Number(raw.portion_g ?? raw.gramm ?? raw.amount_g ?? 0);
  const portionMl = Number(raw.portion_ml ?? raw.ml ?? raw.amount_ml ?? 0);
  const is_beer = BEER_RE.test(name) && !BEER_FOOD_RE.test(name);
  const isBeverage = /getränk|drink/i.test(category) ||
    is_beer ||
    (BEVERAGE_NAME_RE.test(name) && !BEVERAGE_FOOD_RE.test(name));
  let portion = portionG > 0 ? portionG : portionMl > 0 ? portionMl : 0;
  if (!(portion > 0)) portion = isBeverage ? 200 : 100;
  return {
    name,
    portion_g: Number.isFinite(portion) && portion > 0 ? portion : 100,
    category,
    is_beer,
  };
}

function safeParseJson(content) {
  if (typeof content !== "string") return content;
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const ESTIMATE_KEYS = [
  "kcal","protein_g","fat_g","sat_fat_g","trans_fat_g","carbs_g","sugar_g","fiber_g","salt_g","sodium_mg","potassium_mg","calcium_mg","magnesium_mg","iron_mg","zinc_mg","phosphorus_mg","vitamin_a_mg","vitamin_c_mg","vitamin_d_ug","vitamin_e_mg","vitamin_b1_mg","vitamin_b2_mg","vitamin_b6_mg","vitamin_b12_ug","niacin_mg","vitamin_k_ug","folate_ug","cholesterol_mg",
];

export async function estimateNutrients(foodName, category = "") {
  if (!config.mistral.apiKey) return null;
  const ctx = category && category.toLowerCase() !== "sonstiges" ? ` (Kategorie: ${category})` : "";
  const body = {
    model: config.mistral.model,
    temperature: 0.2,
    messages: [
      { role: "user", content: `${NUTRIENT_PROMPT}\n\nLebensmittel: ${String(foodName).slice(0, 80)}${ctx}` },
    ],
    response_format: { type: "json_object" },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(config.mistral.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.mistral.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    console.warn(`Mistral-Nährstoffschätzung fetch Fehler für "${foodName}":`, e.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    console.warn(`Mistral-Nährstoffschätzung ${res.status} für "${foodName}"`);
    return null;
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = safeParseJson(content);
  if (!parsed || typeof parsed !== "object") return null;
  const out = {};
  for (const k of ESTIMATE_KEYS) {
    const v = Number(parsed[k]);
    out[k] = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  return out;
}
