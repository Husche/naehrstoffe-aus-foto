export interface FoodItem {
  name: string;
  category: string;
  portion_g: number;
  is_beer: boolean;
  source: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  sat_fat_g: number;
  carbs_g: number;
  sugar_g: number;
  fiber_g: number;
  salt_g: number;
  sodium_mg: number;
  potassium_mg: number;
  calcium_mg: number;
  magnesium_mg: number;
  iron_mg: number;
  zinc_mg: number;
  phosphorus_mg: number;
  vitamin_a_mg: number;
  vitamin_c_mg: number;
  vitamin_d_ug: number;
  vitamin_e_mg: number;
  vitamin_b1_mg: number;
  vitamin_b2_mg: number;
  vitamin_b6_mg: number;
  vitamin_b12_ug: number;
  niacin_mg: number;
  vitamin_k_ug: number;
  folate_ug: number;
  cholesterol_mg: number;
  per100?: Record<string, number> & { source?: string };
}

export interface Meal {
  meal_id: string;
  timestamp: string;
  items: FoodItem[];
  beer_flag: boolean;
  photo?: string;
  sanity_issues: string[];
  synced: boolean;
}

export interface AnalyzeResponse {
  items: FoodItem[];
  beer_detected: boolean;
  sanity_issues: string[];
}

export const MACRO_LABELS: Record<string, string> = {
  kcal: "Brennwert (kcal)",
  protein_g: "Protein (g)",
  fat_g: "Fett (g)",
  carbs_g: "Kohlenhydrate (g)",
  fiber_g: "Ballaststoffe (g)",
  sugar_g: "davon Zucker (g)",
  salt_g: "Salz (g)",
  sodium_mg: "Natrium (mg)",
  potassium_mg: "Kalium (mg)",
  calcium_mg: "Kalzium (mg)",
  magnesium_mg: "Magnesium (mg)",
  iron_mg: "Eisen (mg)",
  zinc_mg: "Zink (mg)",
  phosphorus_mg: "Phosphor (mg)",
  vitamin_a_mg: "Vitamin A (mg)",
  vitamin_c_mg: "Vitamin C (mg)",
  vitamin_d_ug: "Vitamin D (µg)",
  vitamin_e_mg: "Vitamin E (mg)",
  vitamin_b1_mg: "Vitamin B1 (mg)",
  vitamin_b2_mg: "Vitamin B2 (mg)",
  vitamin_b6_mg: "Vitamin B6 (mg)",
  vitamin_b12_ug: "Vitamin B12 (µg)",
  niacin_mg: "Niacin (mg)",
  vitamin_k_ug: "Vitamin K (µg)",
  folate_ug: "Folat (µg)",
  cholesterol_mg: "Cholesterin (mg)",
  sat_fat_g: "ges. Fett (g)",
};

export const MACRO_KEYS = [
  "kcal",
  "protein_g",
  "fat_g",
  "carbs_g",
  "fiber_g",
] as const;

export const MICRO_KEYS = [
  "sugar_g",
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
  "sat_fat_g",
] as const;

export function emptyFoodItem(name = ""): FoodItem {
  return {
    name,
    category: "Sonstiges",
    portion_g: 100,
    is_beer: false,
    source: "manuell",
    kcal: 0,
    protein_g: 0,
    fat_g: 0,
    sat_fat_g: 0,
    carbs_g: 0,
    sugar_g: 0,
    fiber_g: 0,
    salt_g: 0,
    sodium_mg: 0,
    potassium_mg: 0,
    calcium_mg: 0,
    magnesium_mg: 0,
    iron_mg: 0,
    zinc_mg: 0,
    phosphorus_mg: 0,
    vitamin_a_mg: 0,
    vitamin_c_mg: 0,
    vitamin_d_ug: 0,
    vitamin_e_mg: 0,
    vitamin_b1_mg: 0,
    vitamin_b2_mg: 0,
    vitamin_b6_mg: 0,
    vitamin_b12_ug: 0,
    niacin_mg: 0,
    vitamin_k_ug: 0,
    folate_ug: 0,
    cholesterol_mg: 0,
    per100: {},
  };
}

export const NUTRIENT_NUMERIC_KEYS = [
  "kcal",
  "protein_g",
  "fat_g",
  "sat_fat_g",
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
] as const;

export function rescaleItem(item: FoodItem): FoodItem {
  const p = item.per100;
  if (!p) return item;
  const factor = item.portion_g / 100;
  const copy: FoodItem = { ...item };
  for (const k of NUTRIENT_NUMERIC_KEYS) {
    const base = Number(p[k as string] ?? 0);
    (copy as any)[k] = Math.round(base * factor * 100) / 100;
  }
  return copy;
}
