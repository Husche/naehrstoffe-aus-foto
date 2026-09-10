-- Schema für Nährwertdaten (zusätzlich zu bestehenden Gesundheitsdaten).
-- Die App legt diese Tabelle beim Start automatisch an (idempotent), wenn eine
-- DB konfiguriert ist. Dieses Skript ist eine optionale, explizite Alternative
-- (z.B. zum Anlegen eines separaten Schemas / Users durch den DBA).

-- Optional: eigenes Schema statt public
-- CREATE SCHEMA IF NOT EXISTS naehrstoff AUTHORIZATION naehrstoff;

CREATE TABLE IF NOT EXISTS nutrition_log (
  time           TIMESTAMPTZ NOT NULL,
  meal_id        TEXT NOT NULL,
  item_idx       INT  NOT NULL,
  food_item      TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'Sonstiges',
  portion_g      REAL NOT NULL DEFAULT 0,
  is_beer        BOOLEAN NOT NULL DEFAULT FALSE,
  source         TEXT NOT NULL DEFAULT '',
  beer_flag      BOOLEAN NOT NULL DEFAULT FALSE,
  sanity_issues  TEXT[] NOT NULL DEFAULT '{}',
  kcal           REAL NOT NULL DEFAULT 0,
  protein_g      REAL NOT NULL DEFAULT 0,
  fat_g          REAL NOT NULL DEFAULT 0,
  sat_fat_g      REAL NOT NULL DEFAULT 0,
  trans_fat_g    REAL NOT NULL DEFAULT 0,
  carbs_g        REAL NOT NULL DEFAULT 0,
  sugar_g        REAL NOT NULL DEFAULT 0,
  fiber_g        REAL NOT NULL DEFAULT 0,
  salt_g         REAL NOT NULL DEFAULT 0,
  sodium_mg      REAL NOT NULL DEFAULT 0,
  potassium_mg   REAL NOT NULL DEFAULT 0,
  calcium_mg     REAL NOT NULL DEFAULT 0,
  magnesium_mg   REAL NOT NULL DEFAULT 0,
  iron_mg        REAL NOT NULL DEFAULT 0,
  zinc_mg        REAL NOT NULL DEFAULT 0,
  phosphorus_mg  REAL NOT NULL DEFAULT 0,
  vitamin_a_mg   REAL NOT NULL DEFAULT 0,
  vitamin_c_mg   REAL NOT NULL DEFAULT 0,
  vitamin_d_ug   REAL NOT NULL DEFAULT 0,
  vitamin_e_mg   REAL NOT NULL DEFAULT 0,
  vitamin_b1_mg  REAL NOT NULL DEFAULT 0,
  vitamin_b2_mg  REAL NOT NULL DEFAULT 0,
  vitamin_b6_mg  REAL NOT NULL DEFAULT 0,
  vitamin_b12_ug REAL NOT NULL DEFAULT 0,
  niacin_mg      REAL NOT NULL DEFAULT 0,
  vitamin_k_ug   REAL NOT NULL DEFAULT 0,
  folate_ug      REAL NOT NULL DEFAULT 0,
  cholesterol_mg REAL NOT NULL DEFAULT 0,
  per100         JSONB,
  PRIMARY KEY (meal_id, item_idx, time)
);

-- Als TimescaleDB-Hypertable anlegen (nur wenn Extension vorhanden).
-- SELECT create_hypertable('nutrition_log', 'time', if_not_exists => TRUE);

-- Lese-Hilfsindex für typische "letzte Mahlzeiten"-Abfragen.
CREATE INDEX IF NOT EXISTS idx_nutrition_log_time_desc
  ON nutrition_log (time DESC);

-- Optional: Retention Policy (z.B. Daten älter als 5 Jahre automatisch löschen).
-- SELECT add_retention_policy('nutrition_log', INTERVAL '5 years');

-- Optional: Dedizierter ReadOnly-User für Analytik/Visualisierung.
-- CREATE ROLE naehrstoff_ro LOGIN PASSWORD '...';
-- GRANT USAGE ON SCHEMA public TO naehrstoff_ro;
-- GRANT SELECT ON nutrition_log TO naehrstoff_ro;
