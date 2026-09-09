# Installation & Voraussetzungen – Nährstoffe aus Foto

Diese Anleitung beschreibt die komplette Einrichtung der Anwendung von Grund auf.

## Voraussetzungen

### Software
- **Node.js 22+** (für Entwicklung und Docker-Build)
- **npm** (mitgeliefert)
- **Docker + Docker Compose** (für Produktiv-Deployment, z. B. auf Proxmox)
- **Reverse Proxy mit HTTPS** (Nginx/Traefik/Caddy) – zwingend für WebAuthn (FaceID) und Kamera-Zugriff auf dem Handy

### Accounts & API-Keys
1. **Mistral API Key**
   - Konto auf https://console.mistral.ai
   - API-Key erstellen (Modell `mistral-large-latest` mit Vision-Unterstützung)
2. **Google Cloud OAuth (für Drive-Upload, optional)**
   - Google Cloud Console → APIs & Services → Credentials
   - OAuth-Client-ID (Web-Anwendung) erstellen
   - Drive API aktivieren
   - Authorized Redirect URI: `https://<deine-domain>/oauth/google/callback`

### Netzwerk
- Öffentliche Domain mit TLS-Zertifikat (z. B. Let's Encrypt), da WebAuthn/Kamera nur über HTTPS funktionieren (localhost ist exempt).
- Port 8787 im internen Netz frei.

---

## Variante A: Entwicklung (lokal)

```bash
# 1. Repo klonen
git clone https://github.com/Husche/naehrstoffe-aus-foto.git
cd naehrstoffe-aus-foto

# 2. Dependencies (alle drei Ebenen)
npm install
npm --prefix backend install
npm --prefix frontend install

# 3. Umgebung konfigurieren
cp .env.example .env
# Werte eintragen (mindestens MISTRAL_API_KEY):
#   MISTRAL_API_KEY=...
#   GOOGLE_CLIENT_ID=...        (optional, für Drive)
#   GOOGLE_CLIENT_SECRET=...    (optional, für Drive)
#   DRIVE_PARENT_FOLDER_ID=1L03oGMdv1dUcQxS5CssDh0sv028aDK6d

# 4. Starten (Frontend :5173 + Backend :8787)
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8787
- Health-Check: http://localhost:8787/api/health

> Lokal reicht HTTP (localhost ist exempt). Für FaceID/Kamera auf dem Handy später HTTPS nötig.

---

## Variante B: Produktion via Docker (empfohlen für Proxmox)

```bash
git clone https://github.com/Husche/naehrstoffe-aus-foto.git
cd naehrstoffe-aus-foto

cp .env.example .env
nano .env   # Werte eintragen, siehe unten

docker compose up -d --build
```

Die App läuft auf `http://<server-ip>:8787`.

### .env für Produktion (Beispiel)

```env
MISTRAL_API_KEY=dein-mistral-key
MISTRAL_MODEL=mistral-large-latest
GOOGLE_CLIENT_ID=deine-client-id
GOOGLE_CLIENT_SECRET=dein-secret
GOOGLE_REDIRECT_URI=https://naehrstoff.deine-domain.de/oauth/google/callback
DRIVE_PARENT_FOLDER_ID=1L03oGMdv1dUcQxS5CssDh0sv028aDK6d
PORT=8787
CORS_ORIGIN=https://naehrstoff.deine-domain.de
NUTRITION_API=https://world.openfoodfacts.org
```

---

## Reverse Proxy (Nginx mit HTTPS)

WebAuthn (FaceID) und Kamera erfordern HTTPS. Beispiel für Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name naehrstoff.deine-domain.de;

    ssl_certificate     /etc/letsencrypt/live/naehrstoff.deine-domain.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/naehrstoff.deine-domain.de/privkey.pem;

    # Fotos können größer sein
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Zertifikat mit Let's Encrypt:
```bash
certbot --nginx -d naehrstoff.deine-domain.de
```

---

## Proxmox-spezifische Hinweise

Siehe `deploy/proxmox.md`. Zusammenfassung:
- Unprivileged LXC-Container (Debian/Ubuntu) oder VM
- Docker + Docker Compose im Container installieren
- Port 8787 weiterleiten / per Reverse Proxy nach außen bringen
- Persistent: Das `./data` Volume wird für zukünftige Persistenz gemountet

---

## Erste Nutzung

1. App im Browser öffnen: `https://naehrstoff.deine-domain.de`
2. Auf dem iPhone/Android: **„Zum Home-Bildschirm hinzufügen"** → installiert als PWA
3. **FaceID einrichten**: Beim ersten Öffnen „Gesichtserkennung einrichten" → WebAuthn registriert geräte-lokal (Biometrie-Daten verlassen nie das Gerät)
4. Foto vom Essen aufnehmen → Lebensmittel werden erkannt, Portionsgrößen ggf. korrigieren, Speichern
5. **Google Drive verbinden** (im „Heute"-Tab): OAuth-Flow, danach CSVs landen im `Health Analysis`-Folder
6. CSV-Download pro Mahlzeit oder Bulk-Sync zu Drive

---

## CSV-Format (Apple-Health-Pipeline)

```
timestamp,meal_id,food_item,portion_g,carbs_g,protein_g,fat_g,fiber_g,kcal,beer_flag,
sat_fat_g,trans_fat_g,sugar_g,salt_g,sodium_mg,potassium_mg,calcium_mg,magnesium_mg,iron_mg,zinc_mg,
phosphorus_mg,vitamin_a_mg,vitamin_c_mg,vitamin_d_ug,vitamin_e_mg,vitamin_b1_mg,
vitamin_b2_mg,vitamin_b6_mg,vitamin_b12_ug,niacin_mg,vitamin_k_ug,folate_ug,cholesterol_mg
```

---

## Troubleshooting

| Problem | Lösung |
|---------|--------|
| „Mistral API-Key fehlt" | `.env` prüfen, `MISTRAL_API_KEY` setzen, Container neu starten |
| FaceID funktioniert nicht | HTTPS nötig (nicht localhost); Browser muss WebAuthn unterstützen (Safari/Chrome) |
| Kamera startet nicht | HTTPS + Berechtigung erteilen; `capture`-Attribut erfordert sichereren Kontext |
| Drive-Upload schlägt fehl | Redirect-URI in Google Console muss exakt mit `GOOGLE_REDIRECT_URI` übereinstimmen |
| Lebensmittel nicht erkannt | Bessere Beleuchtung, Teller von oben; Bildqualität wurde bewusst hoch gehalten (1600px, Q0.85) |
| OFF findet keine Nährstoffe | Generischeren Namen probieren; OFF ist freie DB, Trefferqualität variiert |

---

## Wartung

- **Update:** `git pull && docker compose up -d --build`
- **Logs:** `docker compose logs -f`
- **Health-Check:** `curl http://<server>:8787/api/health`
- **Cache leeren (Frontend):** Service Worker in Browser de-registrieren oder Versionsnummer in `sw.js` (`CACHE_NAME`) erhöhen
