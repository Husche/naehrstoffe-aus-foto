import express from "express";
import cors from "cors";
import multer from "multer";
import { config } from "./config.js";
import { detectFood } from "./mistral.js";
import { fetchNutrientsBatch, scaleNutrients } from "./nutrition.js";
import { sanityCheckMeal } from "./sanity.js";
import { buildCsv } from "./csv.js";
import {
  getAuthUrl,
  exchangeCode,
  uploadCsvToDrive,
  isConnected,
} from "./drive.js";
import {
  storeGetMeals,
  storeUpsertMeal,
  storeDeleteMeal,
} from "./store.js";

const app = express();
// CORS: Default (leerer corsOrigin) bedeutet same-origin (Backend serviert das
// Frontend selbst) -> CORS bewusst NICHT aktivieren, damit cors() nicht per Default
// jeden Origin reflektiert (cors(undefined) == cors default == allow-all, was die
// REST-API ohne Auth jedem Origin öffnen würde). CORS_ORIGIN nur für getrennte
// Dev-Server (z. B. http://localhost:5173) setzen.
if (config.corsOrigin) {
  app.use(cors({ origin: config.corsOrigin }));
}
app.use(express.json({ limit: "25mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});
app.use("/assets", express.static("../frontend/dist/assets"));
app.use(express.static("../frontend/dist"));

// --- Health ---
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mistral: !!config.mistral.apiKey,
    drive: isConnected(),
    model: config.mistral.model,
  });
});

// --- Analyse: Foto -> Lebensmittel -> Nährstoffe ---
app.post("/api/analyze", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Kein Foto hochgeladen." });
    }
    const base64 = req.file.buffer.toString("base64");
    const mime = req.file.mimetype || "image/jpeg";

    const detected = await detectFood(base64, mime);

    // Nährstoffe parallel für alle Lebensmittel abfragen.
    const per100s = await fetchNutrientsBatch(detected.map((d) => d.name));
    const items = detected.map((d, i) => {
      const per100 = per100s[i];
      const scaled = scaleNutrients(per100, d.portion_g);
      return {
        name: d.name,
        category: d.category,
        portion_g: d.portion_g,
        is_beer: d.is_beer,
        source: per100.source,
        per100,
        ...scaled,
      };
    });
    const beerDetected = items.some((it) => it.is_beer);

    const sanityIssues = sanityCheckMeal(items);

    res.json({
      items,
      beer_detected: beerDetected,
      sanity_issues: sanityIssues,
    });
  } catch (e) {
    console.error("Analyze Fehler:", e);
    res.status(500).json({ error: e.message });
  }
});

// --- CSV aus Mahlzeit generieren ---
app.post("/api/csv", (req, res) => {
  try {
    const meal = req.body;
    if (!meal || !Array.isArray(meal.items)) {
      return res.status(400).json({ error: "Ungültige Mahlzeit." });
    }
    const csv = buildCsv(meal);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="naehrstoffe_${meal.meal_id || "export"}.csv"`
    );
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Serverseitige Mahlzeiten-Persistenz (Multi-Gerät-Sync) ---
app.get("/api/meals", async (req, res) => {
  try {
    const meals = await storeGetMeals();
    meals.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    res.json({ meals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/meals", async (req, res) => {
  try {
    const meal = req.body;
    if (!meal || !meal.meal_id || !Array.isArray(meal.items)) {
      return res.status(400).json({ error: "Ungültige Mahlzeit." });
    }
    await storeUpsertMeal(meal);
    res.json({ ok: true, meal_id: meal.meal_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/meals/:meal_id", async (req, res) => {
  try {
    await storeDeleteMeal(req.params.meal_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Google Drive OAuth ---
app.get("/api/drive/auth-url", (req, res) => {
  if (!config.drive.clientId) {
    return res
      .status(400)
      .json({ error: "Google Drive nicht konfiguriert (GOOGLE_CLIENT_ID fehlt)." });
  }
  res.json({ url: getAuthUrl() });
});

app.get("/api/drive/status", (req, res) => {
  res.json({ connected: isConnected() });
});

app.get("/oauth/google/callback", async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return res.status(400).send(`OAuth Fehler: ${error}`);
    if (!code) return res.status(400).send("Kein Code erhalten.");
    await exchangeCode(code);
    res.send(
      "<h1>Google Drive verbunden</h1><p>Du kannst dieses Fenster schließen.</p>"
    );
  } catch (e) {
    res.status(500).send(`OAuth fehlgeschlagen: ${e.message}`);
  }
});

// --- CSV nach Google Drive hochladen ---
app.post("/api/drive/upload", async (req, res) => {
  try {
    const meal = req.body;
    if (!meal || !Array.isArray(meal.items)) {
      return res.status(400).json({ error: "Ungültige Mahlzeit." });
    }
    const csv = buildCsv(meal);
    const filename = `naehrstoffe_${meal.meal_id || Date.now()}.csv`;
    const result = await uploadCsvToDrive(filename, csv);
    res.json({ ok: true, file_id: result.id, name: result.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- SPA Fallback (nur für nicht-API-Routen) ---
app.get("*", (req, res, next) => {
  // API-Routen, die hier landen, sind unbekannt -> sauberer 404 statt index.html.
  if (req.path.startsWith("/api/") || req.path.startsWith("/oauth/")) {
    return res.status(404).json({ error: "Nicht gefunden." });
  }
  res.sendFile("index.html", { root: "../frontend/dist" }, (err) => {
    if (err) res.status(404).send("Frontend nicht gebaut. Führe 'npm run build' aus.");
  });
});

app.listen(config.port, () => {
  console.log(`Nährstoff-Backend läuft auf :${config.port}`);
  console.log(`Mistral: ${config.mistral.apiKey ? "konfiguriert" : "FEHLT"}`);
  console.log(`Drive: ${isConnected() ? "verbunden" : "nicht verbunden"}`);
});
