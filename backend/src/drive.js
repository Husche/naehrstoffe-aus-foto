import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// Token-Persistenz: Tokens überleben einen Server-Neustart (Docker/Proxmox),
// damit der OAuth-Flow nicht bei jedem Recycle wiederholt werden muss.
const TOKEN_FILE = path.resolve(process.cwd(), "data", "drive_tokens.json");

async function persistTokens() {
  if (!config.drive.tokens) return;
  try {
    await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
    await fs.writeFile(TOKEN_FILE, JSON.stringify(config.drive.tokens), "utf-8");
  } catch {
    /* nicht fatal: In-Memory-Token gilt für Prozesslebensdauer */
  }
}

async function loadPersistedTokens() {
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    config.drive.tokens = JSON.parse(raw);
  } catch {
    /* keine Datei -> nicht verbunden */
  }
}

export function getAuthUrl(state = "naehrstoff") {
  const params = new URLSearchParams({
    client_id: config.drive.clientId,
    redirect_uri: config.drive.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.drive.clientId,
      client_secret: config.drive.clientSecret,
      redirect_uri: config.drive.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Token Exchange fehlgeschlagen: ${await res.text()}`);
  }
  const tokens = await res.json();
  config.drive.tokens = {
    ...tokens,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
  await persistTokens();
  return config.drive.tokens;
}

export async function refreshIfNeeded() {
  const t = config.drive.tokens;
  if (!t) throw new Error("Google Drive nicht verbunden. Bitte erst OAuth durchführen.");
  const expired = !t.expires_at || Date.now() >= t.expires_at - 60000;
  if (!expired) return t.access_token;
  if (!t.refresh_token) throw new Error("Refresh-Token fehlt. Bitte OAuth erneut durchführen.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.drive.clientId,
      client_secret: config.drive.clientSecret,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Token Refresh fehlgeschlagen: ${await res.text()}`);
  }
  const fresh = await res.json();
  config.drive.tokens = {
    ...t,
    ...fresh,
    expires_at: Date.now() + (fresh.expires_in || 3600) * 1000,
  };
  await persistTokens();
  return config.drive.tokens.access_token;
}

// Beim Modul-Laden persistierte Tokens wiederherstellen (sicherer Hook am Dateiende).

export function isConnected() {
  return !!config.drive.tokens;
}

export async function uploadCsvToDrive(filename, csvContent) {
  const accessToken = await refreshIfNeeded();
  const metadata = {
    name: filename,
    parents: [config.drive.parentFolderId],
    mimeType: "text/csv",
  };
  const boundary = "naehrstoffBoundary";
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    "Content-Type: text/csv\r\n\r\n" +
    csvContent +
    `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) {
    throw new Error(`Drive Upload fehlgeschlagen: ${await res.text()}`);
  }
  const data = await res.json();
  return data;
}

// Persistierte Tokens beim Modul-Laden wiederherstellen (Fire-and-forget).
loadPersistedTokens();
