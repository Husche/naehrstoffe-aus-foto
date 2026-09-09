import dotenv from "dotenv";
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || "8787", 10),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  mistral: {
    apiKey: process.env.MISTRAL_API_KEY || "",
    model: process.env.MISTRAL_MODEL || "mistral-large-latest",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
  },
  nutrition: {
    baseUrl: process.env.NUTRITION_API || "https://world.openfoodfacts.org",
  },
  drive: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:8787/oauth/google/callback",
    parentFolderId:
      process.env.DRIVE_PARENT_FOLDER_ID ||
      "1L03oGMdv1dUcQxS5CssDh0sv028aDK6d",
    // In-memory token store (single-user, Proxmox self-host). Persists within process lifetime.
    tokens: null,
  },
};

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Fehlende Umgebungsvariable: ${name}`);
  }
  return v;
}
