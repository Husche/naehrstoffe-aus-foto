# Proxmox LXC / VM – Nährstoffe aus Foto

Diese Anleitung beschreibt das Deployment auf Proxmox (LXC Container oder VM) mit Docker.

## Voraussetzungen auf dem Proxmox-Host
- Ein LXC-Container (unprivileged) mit Debian/Ubuntu oder eine VM.
- Docker + Docker Compose installiert (`apt install docker.io docker-compose`).
- Ein Reverse Proxy (z.B. Nginx/Traefik) mit TLS-Zertifikat, da WebAuthn (FaceID) und Kamera HTTPS erfordern.

## 1. Repository klonen
```bash
git clone https://github.com/Husche/naehrstoffe-aus-foto.git
cd naehrstoffe-aus-foto
```

## 2. `.env` anlegen
```bash
cp .env.example .env
# Werte eintragen, besonders MISTRAL_API_KEY und Google Drive Credentials
nano .env
```
Wichtig für externe Erreichbarkeit:
```
GOOGLE_REDIRECT_URI=https://naehrstoff.deine-domain.de/oauth/google/callback
CORS_ORIGIN=https://naehrstoff.deine-domain.de
```

## 3. Bauen & Starten
```bash
docker compose up -d --build
```
Die App läuft dann auf `http://<container-ip>:8787`.

## 4. Reverse Proxy (Nginx Beispiel)
```nginx
server {
    listen 443 ssl http2;
    server_name naehrstoff.deine-domain.de;

    ssl_certificate     /etc/letsencrypt/live/naehrstoff.deine-domain.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/naehrstoff.deine-domain.de/privkey.pem;

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

## 5. Google OAuth Console einrichten
- Google Cloud Console → APIs & Services → Credentials → OAuth Client ID (Web).
- Authorized redirect URI: `https://naehrstoff.deine-domain.de/oauth/google/callback`
- `GOOGLE_CLIENT_ID` und `GOOGLE_CLIENT_SECRET` in `.env` eintragen.
- Google Drive API aktivieren.

## 6. App nutzen
- Im Browser `https://naehrstoff.deine-domain.de` öffnen.
- Auf dem iPhone/Android "Zum Home-Bildschirm hinzufügen" → installiert als PWA.
- FaceID: Beim ersten Öffnen "Gesichtserkennung einrichten" → WebAuthn registriert geräte-lokal.

## 7. TimescaleDB-Anbindung (optional, parallel zu Google Drive)

Die Nährwertdaten werden zustätzlich zur CSV-Datei in Google Drive in eine
TimescaleDB / PostgreSQL geschrieben, die ebenfalls auf dem Proxmox läuft (z. B.
im `tsdb`-Container). So lassen sich die Nährwerte direkt mit den bestehenden
Gesundheitsdaten (Zeitreihen) korrelieren.

Die beiden Container laufen nebeneinander im selben LAN
(`192.168.178.0/24`); die Web App verbindet sich über das Netzwerk zur DB.

### 7.1 DB vorbereiten (einmalig, im tsdb-Container)

```bash
# Im tsdb-Container (z. B. 192.168.178.12):
sudo -u postgres psql
```

```sql
CREATE USER naehrstoff WITH PASSWORD '<sicheres-passwort>';
CREATE DATABASE health OWNER naehrstoff;
\c health
CREATE EXTENSION IF NOT EXISTS timescaledb;
-- Schema anlegen (die App tut das beim Start automatisch, alternativ das
-- beiliegende Skript deploy/timescaledb-schema.sql ausführen):
\i deploy/timescaledb-schema.sql
GRANT ALL ON nutrition_log TO naehrstoff;
```

`pg_hba.conf` so einstellen, dass der App-Container sich mit der DB verbinden
darf (z. B. `host health naehrstoff 192.168.178.0/24 scram-sha-256`).

### 7.2 Web App konfigurieren

In der `.env` (Abschnitt "TimescaleDB") eintragen:

```
PGHOST=192.168.178.12
PGPORT=5432
PGDATABASE=health
PGUSER=naehrstoff
PGPASSWORD=<sicheres-passwort>
```

Oder als komplette URL:

```
DATABASE_URL=postgresql://naehrstoff:<passwort>@192.168.178.12:5432/health
```

Ohne diese Werte bleibt die DB-Anbindung deaktiv und das Backend fällt
automatisch auf die Datei-basierte Persistenz (`data/meals.json`) zurück.

### 7.3 Verhalten

- Beim Start initialisiert das Backend die Verbindung und legt die Tabelle
  `nutrition_log` (ggf. als Timescale-Hypertable) idempotent an.
- `/api/health` meldet `timescale: true/false`.
- Mahlzeiten werden parallel in die JSON-Datei (lokaler Cache/Backup) und in
  die DB geschrieben. DB-Fehler brechen den Request nicht ab (Best-Effort).
- Beim Lesen (`/api/meals`) ist die DB die primäre Quelle, die JSON-Datei dient
  als Fallback.
- Google-Drive-Upload bleibt davon unberührt (parallel).
