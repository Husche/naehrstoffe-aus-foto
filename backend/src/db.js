// TimescaleDB / PostgreSQL-Anbindung für Nährwertdaten (zusätzlich zur
// JSON-Datei-Persistenz in store.js). Die Nährwertdaten werden als Zeitreihe
// in der Hypertabelle `nutrition_log` abgelegt, so dass sie direkt mit den
// bestehenden Gesundheitsdaten (Zeitreihen) korrelierbar sind.
//
// Optional: Ohne konfigurierte DB (keine DATABASE_URL / PGHOST) sind alle
// Funktionen No-Ops bzw. liefern leere Ergebnisse, sodass das Backend auch ohne
// DB lauffähig bleibt (Fallback auf data/meals.json).

import { config } from "./config.js";
import { NUTRIENT_COLUMNS } from "./nutrition.js";

let pool = null;
let ready = false;

// PostgreSQL-Identifier dürfen nur [A-Za-z_][A-Za-z0-9_]* sein. Schema/Tabellen-
// Namen werden als Identifier interpoliert (Parametrisierung ist für Identifier
// nicht möglich), daher Whitelist-Validierung gegen SQL-Injection.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function connectionString() {
  if (config.timescale.url) return config.timescale.url;
  const { host, port, database, user, password } = config.timescale;
  if (!host || !database || !user) return "";
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function qualifiedTable() {
  const schema = config.timescale.schema;
  if (!IDENT_RE.test(schema)) {
    throw new Error(`Ungültiger DB_SCHEMA-Name: '${schema}'`);
  }
  return `${schema}.nutrition_log`;
}

export function dbConfigured() {
  return !!connectionString();
}

export function dbReady() {
  return ready;
}

export async function dbInit() {
  const cs = connectionString();
  if (!cs) return false;
  if (!pool) {
    const pg = await import("pg");
    const Pool = pg.default.Pool || pg.Pool;
    pool = new Pool({
      connectionString: cs,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    pool.on("error", (err) => {
      console.error("TimescaleDB Pool Fehler:", err.message);
    });
  }
  try {
    await ensureSchema();
    ready = true;
    return true;
  } catch (e) {
    // Bei fehlgeschlagener Schema-Init Pool sauber schließen, damit keine
    // offene Verbindung/Konfiguration hängen bleibt. ready bleibt false,
    // das Backend fällt auf die Datei-Persistenz zurück.
    const p = pool;
    pool = null;
    ready = false;
    if (p) await p.end().catch(() => {});
    throw e;
  }
}

async function ensureSchema() {
  const table = qualifiedTable();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const colsSql = NUTRIENT_COLUMNS.map((c) => `${c} REAL NOT NULL DEFAULT 0`).join(", ");
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${table} (
        time TIMESTAMPTZ NOT NULL,
        meal_id TEXT NOT NULL,
        item_idx INT NOT NULL,
        food_item TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Sonstiges',
        portion_g REAL NOT NULL DEFAULT 0,
        is_beer BOOLEAN NOT NULL DEFAULT FALSE,
        source TEXT NOT NULL DEFAULT '',
        beer_flag BOOLEAN NOT NULL DEFAULT FALSE,
        sanity_issues TEXT[] NOT NULL DEFAULT '{}',
        ${colsSql},
        per100 JSONB,
        PRIMARY KEY (meal_id, item_idx, time)
      )`
    );
    // TimescaleDB Hypertable (idempotent). In reiner PostgreSQL-Umgebung ohne
    // Timescale-Extension ist create_hypertable nicht verfügbar -> überspringen.
    const { rows } = await client.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'"
    );
    if (rows.length) {
      await client.query(
        `SELECT create_hypertable('${table}', 'time', if_not_exists => TRUE)`
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function clampNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function sanitizeForDb(meal) {
  const meal_id = String(meal?.meal_id || "").slice(0, 100);
  const timestamp = String(
    meal?.timestamp || new Date().toISOString()
  ).slice(0, 40);
  const beer_flag = !!meal?.beer_flag;
  const sanity_issues = Array.isArray(meal?.sanity_issues)
    ? meal.sanity_issues.slice(0, 50).map((s) => String(s).slice(0, 300))
    : [];
  const rawItems = Array.isArray(meal?.items) ? meal.items.slice(0, 100) : [];
  const items = rawItems.map((it) => {
    const item = {
      name: String(it?.name || "").slice(0, 200),
      category: String(it?.category || "Sonstiges").slice(0, 50),
      portion_g: Math.max(0, Math.min(2500, Number(it?.portion_g) || 0)),
      is_beer: !!it?.is_beer,
      source: String(it?.source || "").slice(0, 100),
    };
    for (const col of NUTRIENT_COLUMNS) item[col] = clampNum(it?.[col]);
    if (it?.per100 && typeof it.per100 === "object") {
      const per100 = {};
      for (const col of NUTRIENT_COLUMNS) per100[col] = clampNum(it.per100[col]);
      per100.source = String(it.per100.source || "").slice(0, 100);
      item.per100 = per100;
    }
    return item;
  });
  return { meal_id, timestamp, beer_flag, sanity_issues, items };
}

// Schreibt eine Mahlzeit (Upsert: vorherige Zeilen derselben meal_id löschen,
// dann neu einfügen -> idempotent bei Multi-Gerät-Sync).
// Hinweis: Eine Mahlzeit ohne items bewirkt nur das DELETE -> sie existiert in
// der DB dann nicht (leere Mahlzeit). Die Datei-Persistenz speichert sie
// dagegen als leere items-Liste. Für Single-User/Best-Effort akzeptabel.
export async function dbUpsertMeal(meal) {
  if (!dbReady()) return false;
  const clean = sanitizeForDb(meal);
  if (!clean.meal_id) throw new Error("Ungültige meal_id.");
  const table = qualifiedTable();
  // Timestamp robust als ISO-String normalisieren, egal ob 'Z', Offset oder
  // naiv. new Date(validates) wirft/NaN bei Müll -> dann Serverzeit.
  const parsed = new Date(clean.timestamp);
  const ts = Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM ${table} WHERE meal_id = $1`, [
      clean.meal_id,
    ]);
    for (let i = 0; i < clean.items.length; i++) {
      const it = clean.items[i];
      const cols = [
        "time",
        "meal_id",
        "item_idx",
        "food_item",
        "category",
        "portion_g",
        "is_beer",
        "source",
        "beer_flag",
        "sanity_issues",
        ...NUTRIENT_COLUMNS,
        "per100",
      ];
      const values = [
        ts,
        clean.meal_id,
        i,
        it.name,
        it.category,
        it.portion_g,
        it.is_beer,
        it.source,
        clean.beer_flag,
        clean.sanity_issues,
        ...NUTRIENT_COLUMNS.map((c) => it[c]),
        it.per100 ? JSON.stringify(it.per100) : null,
      ];
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");
      const insertSql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
      await client.query(insertSql, values);
    }
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function dbDeleteMeal(meal_id) {
  if (!dbReady()) return false;
  const id = String(meal_id || "").slice(0, 100);
  const table = qualifiedTable();
  await pool.query(`DELETE FROM ${table} WHERE meal_id = $1`, [id]);
  return true;
}

// Liest alle Mahlzeiten aus der DB und rekonstruiert das Meal-Format, das das
// Frontend erwartet (kompatibel mit storeGetMeals aus store.js).
export async function dbGetMeals() {
  if (!dbReady()) return [];
  const table = qualifiedTable();
  const { rows } = await pool.query(
    `SELECT * FROM ${table} ORDER BY time DESC, meal_id, item_idx`
  );
  return rowsToMeals(rows);
}

// Liest eine einzelne Mahlzeit aus der DB (Rekonstruktion wie dbGetMeals).
export async function dbGetMeal(meal_id) {
  if (!dbReady()) return null;
  const id = String(meal_id || "").slice(0, 100);
  const table = qualifiedTable();
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE meal_id = $1 ORDER BY item_idx`,
    [id]
  );
  const meals = rowsToMeals(rows);
  return meals.length ? meals[0] : null;
}

function rowsToMeals(rows) {
  const byMeal = new Map();
  for (const r of rows) {
    if (!byMeal.has(r.meal_id)) {
      byMeal.set(r.meal_id, {
        meal_id: r.meal_id,
        timestamp: new Date(r.time).toISOString(),
        beer_flag: r.beer_flag,
        sanity_issues: r.sanity_issues || [],
        items: [],
        synced: true,
      });
    }
    const m = byMeal.get(r.meal_id);
    const item = {
      name: r.food_item,
      category: r.category,
      portion_g: r.portion_g,
      is_beer: r.is_beer,
      source: r.source,
    };
    for (const col of NUTRIENT_COLUMNS) {
      item[col] = Number(r[col]) || 0;
    }
    if (r.per100 && typeof r.per100 === "object") {
      const per100 = {};
      for (const col of NUTRIENT_COLUMNS) per100[col] = Number(r.per100[col]) || 0;
      per100.source = String(r.per100.source || "");
      item.per100 = per100;
    }
    m.items.push(item);
  }
  return Array.from(byMeal.values());
}
