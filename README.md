# Nährstoffe aus Foto

Extrahiert Makronährstoffe, Vitamine und Mineralstoffe aus einem Foto vom Essen und schreibt diese in eine Datenbank / CSV. Mobile-first Web-App für iPhone & Android.

## Architektur

```
┌───────────────┐    ┌──────────────────┐    ┌──────────────┐    ┌─────────────┐
│  React/Vite   │ →  │  Express API     │ →  │ Mistral Large │   │ Open Food   │
│  Frontend     │ ←  │  (Node.js)       │ ←  │  Vision       │   │  Facts API  │
│  (IndexedDB)  │    │  CSV + Drive     │    └──────────────┘    └─────────────┘
└───────────────┘    └──────────────────┘
```

- **Frontend:** React + TypeScript (Vite), mobile-first, deutschsprachig
- **Backend:** Node.js/Express (ESM)
- **Bildanalyse:** Mistral Large Vision (Lebensmittelerkennung + Portionsgröße)
- **Nährstoffdaten:** Open Food Facts (kostenlos, keine Edamame)
- **Export:** CSV im Apple-Health-Pipeline-kompatiblen Format
- **Storage:** Google Drive API (Upload ins "Health Analysis"-Folder)
- **Offline:** IndexedDB, automatischer Sync bei Online-Verbindung
- **Login:** WebAuthn / FaceID / TouchID (geräte-lokal, keine Biometrie-Daten verlassen das Gerät)

## Workflow

1. User macht Foto vom Essen (Kamera oder Upload)
2. Bild wird an Mistral Large Vision gesendet → JSON-Array mit `name`, `portion_g`, `category`
3. Jedes erkannte Lebensmittel wird bei Open Food Facts abgefragt
4. Ergebnisse werden aggregiert: kcal, Kohlenhydrate, Protein, Fett, Ballaststoffe + Mikronährstoffe/Mineralien (Magnesium, Kalzium, Vitamin C, …)
5. **Sanity Check** der Portionsgrößen (heuristische Plausibilitätsprüfung)
6. User kann Portionsgrößen korrigieren und Items hinzufügen/entfernen
7. Speichern mit Timestamp, Meal-ID, Beer-Flag
8. CSV-Download: `timestamp,meal_id,food_item,portion_g,carbs_g,protein_g,fat_g,fiber_g,kcal,beer_flag, …` (alle Mikro-/Makronährstoffe)
9. "Sync to Google Drive" → CSV in den `Health Analysis`-Folder

## Features

- 🍺 **Bier-Erkennung:** Erkennt Mistral Bier auf dem Foto → auto-aktiviert den Beer-Flag
- 🍽️ **Multi-Item:** Ein Foto kann mehrere Lebensmittel enthalten
- 📴 **Offline-Toleranz:** Lokaler Speicher (IndexedDB), Sync wenn wieder online
- 🇩🇪 **Deutschsprachige UI**
- 📱 **Mobile-first** (iPhone & Android), als PWA installierbar
- 🔐 **FaceID-Login** via WebAuthn (erfordert HTTPS)
- ⚖️ **Metrische Angaben** (Gramm, Europa/Deutschland)
- 🍏 **Apple-Health-kompatibles CSV-Format**
- ✅ **Sanity Check** der erkannten Portionsgrößen
- 🏠 **Proxmox-Deployment** (Docker)

## ⚡ Installation & Voraussetzungen

Eine vollständige Installationsanleitung mit allen Voraussetzungen (Node.js, Docker, API-Keys, HTTPS-Reverse-Proxy) findest du in **[INSTALL.md](INSTALL.md)**.

```bash
# 1. Dependencies installieren
npm install            # root (concurrently)
npm --prefix backend install
npm --prefix frontend install

# 2. .env anlegen
cp .env.example .env
# MISTRAL_API_KEY eintragen, Google Drive Credentials optional

# 3. Dev-Server starten (Frontend :5173 + Backend :8787)
npm run dev
```

## Setup (Produktion / Docker / Proxmox)

Siehe [`deploy/proxmox.md`](deploy/proxmox.md).

```bash
cp .env.example .env   # Werte eintragen
docker compose up -d --build
# App läuft auf :8787
```

## API-Keys

Alle Secrets über `.env` (siehe `.env.example`):

| Variable | Beschreibung |
|----------|--------------|
| `MISTRAL_API_KEY` | Mistral API Key für Vision-Modell |
| `MISTRAL_MODEL` | Modellname (Default: `mistral-large-latest`) |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | OAuth Callback URL |
| `DRIVE_PARENT_FOLDER_ID` | Zielordner in Drive (Default: `1L03oGMdv1dUcQxS5CssDh0sv028aDK6d`) |
| `PORT` | Backend-Port (Default: `8787`) |
| `CORS_ORIGIN` | Erlaubte Frontend-Origin |

## CSV-Format (Apple-Health-Pipeline)

Spaltenreihenfolge:
```
timestamp,meal_id,food_item,portion_g,carbs_g,protein_g,fat_g,fiber_g,kcal,beer_flag,
sat_fat_g,sugar_g,salt_g,sodium_mg,potassium_mg,calcium_mg,magnesium_mg,iron_mg,zinc_mg,
phosphorus_mg,vitamin_a_mg,vitamin_c_mg,vitamin_d_ug,vitamin_e_mg,vitamin_b1_mg,
vitamin_b2_mg,vitamin_b6_mg,vitamin_b12_ug,niacin_mg,vitamin_k_ug,folate_ug,cholesterol_mg
```

## API-Endpunkte

| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| `POST` | `/api/analyze` | Foto → Lebensmittel + Nährstoffe (multipart `photo`) |
| `POST` | `/api/csv` | Mahlzeit → CSV-Download |
| `GET`  | `/api/drive/auth-url` | Google OAuth-URL |
| `GET`  | `/api/drive/status` | Drive-Verbindungsstatus |
| `GET`  | `/oauth/google/callback` | OAuth Callback |
| `POST` | `/api/drive/upload` | CSV zu Drive hochladen |
| `GET`  | `/api/health` | Status (Mistral/Drive konfiguriert?) |

## Projektstruktur

```
.
├── backend/
│   ├── src/
│   │   ├── server.js     # Express-App, Endpunkte
│   │   ├── config.js     # Env-Konfiguration
│   │   ├── mistral.js    # Mistral Vision Bildanalyse
│   │   ├── nutrition.js  # Open Food Facts + Skalierung
│   │   ├── sanity.js    # Sanity Check der Portionsgrößen
│   │   ├── csv.js        # CSV-Generierung
│   │   └── drive.js      # Google Drive OAuth + Upload
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx       # Hauptkomponente (Kamera, Ergebnisse, Heute, Historie)
│   │   ├── api.ts        # Backend-API-Calls
│   │   ├── storage.ts    # IndexedDB Offline-Speicher
│   │   ├── auth.ts       # WebAuthn / FaceID
│   │   ├── types.ts      # Typen + Nährstoff-Skalierung
│   │   ├── styles.css    # Mobile-first Styling
│   │   └── main.tsx
│   ├── public/manifest.webmanifest
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── deploy/proxmox.md
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Hinweise

- WebAuthn (FaceID) und Kamera-Zugriff erfordern **HTTPS** im Produktivbetrieb (außer `localhost`).
- Open Food Facts ist eine freie Datenbank – die Trefferqualität variiert; Portionsgrößen sollten vom Nutzer gegengeprüft werden.
- Der Sanity Check warnt bei unplausiblen Portionsgrößen (z.B. 5 kg Reis), blockiert aber nicht.
