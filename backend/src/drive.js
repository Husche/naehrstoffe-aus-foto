import { config } from "./config.js";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

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
  config.drive.tokens = tokens;
  return tokens;
}

export async function refreshIfNeeded() {
  const t = config.drive.tokens;
  if (!t) throw new Error("Google Drive nicht verbunden. Bitte erst OAuth durchführen.");
  const expired = t.expires_at && Date.now() >= t.expires_at - 60000;
  if (!t.refresh_token || !expired) {
    if (!expired) return t.access_token;
  }
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
  return config.drive.tokens.access_token;
}

export function setTokens(tokens) {
  config.drive.tokens = {
    ...tokens,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
}

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
