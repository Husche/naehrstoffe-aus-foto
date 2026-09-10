import type { AnalyzeResponse, Meal } from "./types.ts";

const API = import.meta.env.VITE_API_BASE || "";

async function jsonOrThrow(res: Response): Promise<any> {
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function analyzePhoto(file: File): Promise<AnalyzeResponse> {
  const fd = new FormData();
  fd.append("photo", file);
  const res = await fetch(`${API}/api/analyze`, { method: "POST", body: fd });
  return jsonOrThrow(res);
}

export async function downloadCsv(meal: Meal): Promise<Blob> {
  const res = await fetch(`${API}/api/csv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meal),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.blob();
}

export async function getDriveAuthUrl(): Promise<string> {
  const res = await fetch(`${API}/api/drive/auth-url`);
  const data = await jsonOrThrow(res);
  return data.url;
}

export async function getDriveStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/api/drive/status`);
    const data = await jsonOrThrow(res);
    return !!data.connected;
  } catch {
    return false;
  }
}

export async function uploadToDrive(meal: Meal): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/api/drive/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meal),
  });
  return jsonOrThrow(res);
}

export async function getHealth(): Promise<{
  ok: boolean;
  mistral: boolean;
  drive: boolean;
}> {
  const res = await fetch(`${API}/api/health`);
  return jsonOrThrow(res);
}

// --- Serverseitige Mahlzeiten-Persistenz (Multi-Gerät-Sync) ---

export async function getServerMeals(): Promise<Meal[]> {
  const res = await fetch(`${API}/api/meals`);
  const data = await jsonOrThrow(res);
  return data.meals || [];
}

export async function saveServerMeal(meal: Meal): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/api/meals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meal),
  });
  return jsonOrThrow(res);
}

export async function deleteServerMeal(meal_id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API}/api/meals/${encodeURIComponent(meal_id)}`, {
    method: "DELETE",
  });
  return jsonOrThrow(res);
}
