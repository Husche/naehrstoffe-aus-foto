// Sanity Check für erkannte Portionsgrößen.
// Heuristische Plausibilitätsprüfung gegen realistische Gramm-Bereiche je Kategorie.
const CATEGORY_RANGES = {
  Getreide: [20, 400],
  Reis: [20, 400],
  Nudeln: [20, 400],
  Kartoffeln: [30, 500],
  Gemüse: [10, 600],
  Fleisch: [20, 400],
  Fisch: [20, 400],
  Käse: [5, 200],
  Brot: [10, 300],
  Obst: [10, 500],
  Sauce: [5, 200],
  Suppe: [50, 800],
  Dessert: [20, 400],
  Getränk: [20, 1000],
  Bier: [100, 1000],
  Sonstiges: [5, 800],
};

const GLOBAL_MIN = 2;
const GLOBAL_MAX = 2500;

export function sanityCheckPortion(name, portion_g, category = "Sonstiges") {
  const issues = [];
  const range = CATEGORY_RANGES[category] || CATEGORY_RANGES[Object.keys(CATEGORY_RANGES).find((k) => k.toLowerCase() === String(category).toLowerCase()) || "Sonstiges"];
  if (portion_g < GLOBAL_MIN) {
    issues.push(`${name}: ${portion_g}g ist sehr klein (< ${GLOBAL_MIN}g)`);
  }
  if (portion_g > GLOBAL_MAX) {
    issues.push(`${name}: ${portion_g}g ist sehr groß (> ${GLOBAL_MAX}g)`);
  }
  if (portion_g < range[0] || portion_g > range[1]) {
    issues.push(
      `${name}: ${portion_g}g liegt außerhalb des üblichen Bereichs für "${category}" (${range[0]}–${range[1]}g)`
    );
  }
  return issues;
}

export function sanityCheckMeal(items) {
  const allIssues = [];
  let totalKcal = 0;
  for (const it of items) {
    allIssues.push(...sanityCheckPortion(it.name, it.portion_g, it.category));
    totalKcal += it.kcal || 0;
  }
  if (totalKcal > 3500) {
    allIssues.push(
      `Mahlzeit hat ${Math.round(totalKcal)} kcal – ungewöhnlich hoch für eine einzelne Mahlzeit.`
    );
  }
  return allIssues;
}
