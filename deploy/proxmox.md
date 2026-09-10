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
