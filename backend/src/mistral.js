import { config } from "./config.js";

const FOOD_PROMPT = `Identifiziere alle Lebensmittel auf diesem Teller.
Für jedes Lebensmittel: Name (auf Deutsch), geschätzte Portionsgröße in Gramm (verwende Standardteller-Referenz, Tellerdurchmesser ~25 cm) und eine grobe Kategorie.
Antworte AUSSCHLIESSLICH als JSON-Objekt im folgenden Format, kein Markdown, keine Erklärungen:
{"items":[{"name":"Reis","portion_g":180,"category":"Getreide"}]}
Gib "Bier" als Namen aus, wenn Bier erkennbar ist.`;

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

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || raw.lebensmittel || "").trim();
  if (!name) return null;
  const portion = Number(raw.portion_g ?? raw.gramm ?? raw.amount_g ?? 0);
  return {
    name,
    portion_g: Number.isFinite(portion) && portion > 0 ? portion : 100,
    category: String(raw.category || raw.kategorie || "Sonstiges").trim(),
    is_beer: /bier|beer|pils|weizen|ale|lager/i.test(name),
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
