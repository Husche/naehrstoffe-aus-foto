import { config } from "./config.js";

const FOOD_PROMPT = `Identifiziere alle Lebensmittel und Getränke auf diesem Teller/in diesem Glas.
Für feste Lebensmittel: Name (auf Deutsch), geschätzte Portionsgröße in Gramm und eine grobe Kategorie (z. B. Getreide, Gemüse, Fleisch, Obst, Milchprodukt).
Für Getränke (Wasser, Wein, Saft, Bier, Tee, Kaffee, Limonade, etc.): Name (auf Deutsch), geschätzte Menge in Millilitern als "portion_ml" und Kategorie "Getränk".
Benenne Getränke nach der erkennbaren Flüssigkeit, nicht nach dem Gefäß – z. B. "Wasser", "Rotwein", "Weißwein", "Orangensaft", "Bier", "Tee", "Kaffee". Verwende nicht "Getränk" als Name.

Schätze die Portionsgröße anhand erkennbarer Gefäß-/Tellergrößen und typischer Serviermengen. Nutze diese Referenzen:
- Standardteller: ~25 cm Durchmesser. Beilagen (Reis, Nudeln, Kartoffeln) ~150–200 g, Gemüse ~120–200 g, Fleisch/Fisch ~120–180 g, Soße ~30–60 g.
- Beilagen in Restaurants: Reis/Nudeln meist 150–200 g, Pommes ~150–200 g, Kartoffeln ~200–250 g, Gemüsebeilage ~100–150 g, Salatbeilage ~80–120 g.
- Getränke nach Glas-/Tassengröße: türkisches Teeglas ~120 ml, Kölschglas/Stange 200 ml, Bierseidel 300 ml, Weizenbierglas 500 ml, Wasserglas 200–250 ml, Rotweinglas 150–200 ml, Weißweinglas 150–200 ml, Sektflöte 100–125 ml, Espresso-Tasse 25–30 ml, Kaffee-/Teetasse 150–200 ml, Cappuccino 150–200 ml, Latte-macchiato-Glas 200–250 ml, Limonadenflasche 330–500 ml, Wasserflasche 500–750 ml.
- Vermeide pauschal 200 g/ml. Leite die Menge aus dem erkennbaren Gefäß oder der sichtbaren Menge auf dem Teller ab.

Antworte AUSSCHLIESSLICH als JSON-Objekt im folgenden Format, kein Markdown, keine Erklärungen:
{"items":[{"name":"Reis","portion_g":180,"category":"Getreide"},{"name":"Wasser","portion_ml":200,"category":"Getränk"}]}`;

export async function detectFood(imageBase64, mimeType = "image/jpeg") {
  if (!config.mistral.apiKey) {
    throw new Error(
      "MISTRAL_API_KEY fehlt. Bitte .env konfigurieren (siehe .env.example)."
    );
  }

  const body = {
    model: config.mistral.model,
    temperature: 0.2,
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
  return items.map(normalizeItem).filter(Boolean);
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
