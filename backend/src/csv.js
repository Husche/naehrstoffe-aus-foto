import { NUTRIENT_COLUMNS } from "./nutrition.js";

// CSV-Spaltenreihenfolge: fix für Apple-Health-Pipeline Kompatibilität.
export const CSV_COLUMNS = [
  "timestamp",
  "meal_id",
  "food_item",
  "portion_g",
  "carbs_g",
  "protein_g",
  "fat_g",
  "fiber_g",
  "kcal",
  "beer_flag",
  ...NUTRIENT_COLUMNS.filter((c) =>
    !["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"].includes(c)
  ),
];

export function buildCsv(meal) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const item of meal.items) {
    const row = CSV_COLUMNS.map((col) => {
      if (col === "timestamp") return csvEsc(meal.timestamp);
      if (col === "meal_id") return csvEsc(meal.meal_id);
      if (col === "food_item") return csvEsc(item.name);
      if (col === "portion_g") return num(Math.max(0, item.portion_g));
      if (col === "beer_flag") return meal.beer_flag ? "1" : "0";
      if (col === "kcal") return num(item.kcal);
      const v = item[col];
      return v == null ? "" : num(v);
    });
    rows.push(row.join(","));
  }
  return rows.join("\n") + "\n";
}

function csvEsc(v) {
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  // Negativ-Werte (z. B. durch manipulierte Portionsgroessen) auf 0 begrenzen,
  // damit keine negativen Nährwerte in die Apple-Health-Pipeline gelangen.
  const clamped = n < 0 ? 0 : n;
  return String(Math.round((clamped + Number.EPSILON) * 100) / 100);
}
