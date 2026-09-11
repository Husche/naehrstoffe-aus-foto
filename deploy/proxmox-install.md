# Proxmox-Installation — Nährstoffe aus Foto (eigener App-Container CT 106)

Diese Anleitung beschreibt das schrittweise Deployment der App in einem eigenen
LXC-Container auf Proxmox (Node `pve`), ergänzt um die TimescaleDB-Anbindung und
den Reverse Proxy (Caddy + Cloudflare-Tunnel in CT 104).

> **Wichtig — wer macht was:** Der Mistral-Agent kann Container nur starten/stoppen
> bzw. Configs lesen (Proxmox-Konnektor). **Befehle innerhalb eines Containers,
> die Datenbank-Anlage, die Caddy-Config und den Cloudflare-Tunnel kann der Agent
> NICHT ausführen** — diese Schritte macht der **User an der Proxmox-Shell**
> (bzw. im jeweiligen Container). Alle Befehle unten sind für den User
> geschrieben. Es wird **kein sudo** benötigt (User ist root).

---

## Wer macht was (Übersicht)

| Schritt | Was | Wer | Wo |
|---|---|---|---|
| 0 | PR-Status prüfen (gemergt) | Hinweis | — |
| 1 | App-Container CT 106 erstellen | User | Proxmox-Host-Shell |
| 2 | Docker + docker-compose + git installieren, Repo klonen | User | im CT 106 |
| 3 | `.env` per `pct push` kopieren, chmod 600 | User | Proxmox-Host-Shell |
| 4 | Keys kontrollieren (nicht neu ausfüllen) | User | im CT 106 |
| 5 | DB im tsdb-Container (112) anlegen + pg_hba | User | im CT 112 |
| 6 | App bauen/starten + Logs prüfen | User | im CT 106 |
| 7 | Caddy in CT 104 + Cloudflare Public Hostname | User | CT 104 + Cloudflare-Dashboard |
| 8 | Health-Check + ggf. Google OAuth | User | Host-Shell / Browser |
| 9 | App im Browser nutzen (PWA, FaceID) | User | Handy/Browser |

---

## 0) PR-Status (nur Hinweis)

PR #2 (TimescaleDB-Persistenz) ist bereits auf `main` gemergt:

```
50cbe8a docs: ausfuehrliche .env.template mit Quellen-Hinweisen je Variable
3e656f4 Merge pull request #2 from Husche/vibe/timescaledb-persistenz-...
d3023d0 feat: Nährwertdaten zusätzlich in TimescaleDB speichern (parallel zu Drive)
```

Quellen-Dateien auf `main`:
- `backend/src/db.js` — TimescaleDB-Client, Hypertabelle `nutrition_log`, idempotent
- `backend/src/store.js` — paralleles Schreiben JSON + DB, DB primäre Lesequelle
- `backend/src/config.js` — DB-Konfiguration (DATABASE_URL bzw. PGHOST…)
- `backend/src/server.js` — `/api/health` meldet `timescale`-Status
- `docker-compose.yml` — bindet Port 8787, mountet `./data:/app/data`, liest `.env`
- `deploy/timescaledb-schema.sql` — optionales Schema-Skript

Nichts mehr zu mergen — dieser Stand wird in CT 106 geklont.

---

## 1) App-Container erstellen (VMID 106)

Alle Befehle **auf dem Proxmox-Host** (Node `pve`), nicht im Container.

### 1.1 Debian-12.12-Template prüfen

```bash
pveam update
pveam list local | grep debian-12
```

Erwartet z. B.:
```
local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst
```

> Wenn nur eine ältere Version (z. B. `12.2-1`) auftaucht: `pveam update`
> nochmals laufen lassen und ggf. das genaue 12.12-Template explizit downloaden:
> `pveam download local debian-12-standard_12.12-1_amd64.tar.zst`

Den exakten Templatenamen (rechte Spalte) für den `pct create`-Befehl übernehmen.

### 1.2 Container anlegen (VMID 106, IP 192.168.178.106/24, nesting=1)

`nesting=1` ist zwingend, damit Docker im unprivilegierten LXC läuft.

```bash
pct create 106 local:vztmpl/debian-12-standard_12.12-1_amd64.tar.zst \
  --hostname naehrstoff \
  --cores 2 \
  --memory 2048 \
  --swap 2048 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.178.106/24,gw=192.168.178.1 \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1
```

> `gw=192.168.178.1` an das tatsächliche Gateway im 192.168.178.0/24 anpassen.
> `local-lvm:8` reserviert 8 GB — reicht für App + Docker-Images.

### 1.3 Container starten

```bash
pct start 106
```

Kontrolle:
```bash
pct status 106
# erwartet: status: running
```

---

## 2) Im App-Container: Docker + docker-compose + git, Repo klonen

**Wechsel in den Container** (an der Proxmox-Host-Shell):

```bash
pct enter 106
```

Ab hier bist du **im CT 106** als root. Zuerst Paketquellen aktualisieren und
Basistools installieren:

```bash
apt update && apt -y upgrade
apt -y install ca-certificates curl gnupg git
```

### 2.0 Locale erzeugen (vermeidet `perl: Setting locale failed`)

Frische Debian-LXC-Templates haben oft `LANG=en_US.UTF-8` gesetzt, aber die
Locale noch nicht erzeugt. Das führt zu harmlosen, aber irritierenden
`perl: warning: Setting locale failed`-Meldungen (Befehle laufen trotzdem mit
Fallback `C`). Einmalig erzeugen:

```bash
apt -y install locales
sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen
locale-gen
update-locale LANG=en_US.UTF-8
# in der aktuellen Shell aktivieren:
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
```

### 2.1 Docker installieren (offizieller Weg)

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian bookworm stable" \
  > /etc/apt/sources.list.d/docker.list

apt update
apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

> `docker-compose-plugin` stellt das Kommando `docker compose` bereit (V2).
> Falls du das alte `docker-compose` (V1) benötigst, alternativ
> `apt -y install docker-compose` — für dieses Repo reicht V2.

Docker aktivieren & testen:

```bash
systemctl enable --now docker
docker --version
docker compose version
```

### 2.2 Repo nach /opt klonen

```bash
cd /opt
git clone https://github.com/Husche/naehrstoffe-aus-foto.git
cd naehrstoffe-aus-foto
```

> Noch **kein** `docker compose up` — erst nachdem die `.env` vorliegt (Schritt 3)
> und die DB erreichbar ist (Schritt 5).

Container verlassen (zurück zum Proxmox-Host):
```bash
exit
```

---

## 3) `.env` per `pct push` in den Container kopieren

Die `.env` ist vom User **bereits vollständig ausgefüllt** und liegt auf dem
Proxmox-Host, z. B. unter `/opt/naehrstoffe-aus-foto/.env`.
**Nicht neu ausfüllen** — nur kopieren.

**Auf dem Proxmox-Host** ausführen:

```bash
# Pfad der ausgefüllten .env auf dem Host ggf. anpassen:
pct push 106 /opt/naehrstoffe-aus-foto/.env /opt/naehrstoffe-aus-foto/.env
```

Rechte restriktiv setzen (im Container):

```bash
pct enter 106
chmod 600 /opt/naehrstoffe-aus-foto/.env
chown root:root /opt/naehrstoffe-aus-foto/.env
ls -l /opt/naehrstoffe-aus-foto/.env
# erwartet: -rw------- root root ... .env
exit
```

---

## 4) Keys kontrollieren (nicht neu ausfüllen)

Die API-Keys (Mistral, ggf. Google) sind bereits in der `.env` eingetragen.
Nur Sichtprüfung, ob die Werte vorhanden sind und die richtigen IPs/URLs stehen:

```bash
pct enter 106
grep -Ev '^\s*#|^\s*$' /opt/naehrstoffe-aus-foto/.env
exit
```

Erwartet (Beispiel-Werte nur als Platzhalter — echte Werte in deiner `.env`):

| Variable | Erwartung für dieses Deployment |
|---|---|
| `MISTRAL_API_KEY` | gesetzt (nicht leer) |
| `MISTRAL_MODEL` | `mistral-large-latest` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | gesetzt (falls Drive genutzt) |
| `GOOGLE_REDIRECT_URI` | `https://naehrstoff.deine-domain.de/oauth/google/callback` |
| `DRIVE_PARENT_FOLDER_ID` | eigene Drive-Ordner-ID |
| `DATABASE_URL` **oder** `PGHOST…` | DB-Verbindung zur tsdb (192.168.178.12) |
| `PGHOST` | `192.168.178.12` (wenn DATABASE_URL leer) |
| `PGPORT` | `5432` |
| `PGDATABASE` | `health` |
| `PGUSER` | `naehrstoff` |
| `PGPASSWORD` | das Passwort aus Schritt 5.1 |
| `DB_SCHEMA` | `public` |
| `PORT` | `8787` |
| `CORS_ORIGIN` | `https://naehrstoff.deine-domain.de` |
| `NUTRITION_API` | `https://world.openfoodfacts.org` |

> `CORS_ORIGIN` nicht `*` lassen — das Backend hat keine eigene REST-Auth, siehe
> `backend/src/config.js`. Die produktive Subdomain eintragen.

---

## 5) DB im tsdb-Container (112) vorbereiten

**Wechsel in den bereits laufenden tsdb-Container** (IP 192.168.178.12):

```bash
pct enter 112
```

### 5.1 User / Datenbank / Extension anlegen

```bash
psql -U postgres
```

```sql
-- User (Passwort durch eigenes sicheres Passwort ersetzen;
-- dasselbe Passwort muss in der .env als PGPASSWORD bzw. in DATABASE_URL stehen)
CREATE USER naehrstoff WITH PASSWORD '<sicheres-passwort>';

-- Datenbank, dem User gehörend
CREATE DATABASE health OWNER naehrstoff;

-- in die neue DB wechseln und TimescaleDB-Extension aktivieren
\c health
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

Die Tabelle `nutrition_log` (inkl. Hypertable) legt die **App beim Start selbst
idempotent an** — kein manuelles `CREATE TABLE` nötig. Wer es dennoch explizit
anlegen will, kann stattdessen das beiliegende Skript nutzen:

```sql
-- optional, nur wenn die App die Tabelle NICHT selbst anlegen soll:
-- \i /opt/naehrstoffe-aus-foto/deploy/timescaledb-schema.sql
-- GRANT ALL ON nutrition_log TO naehrstoff;
```

psql verlassen:
```sql
\q
```

### 5.2 LAN-Zugriff in pg_hba.conf erlauben

PostgreSQL erlaubt standardmäßig nur lokale Verbindungen. Für den App-Container
(192.168.178.106) muss eine Regel ergänzt werden. Pfad typisch:
`/etc/postgresql/15/main/pg_hba.conf` (Version ggf. anpassen).

```bash
PGHBA=$(ls /etc/postgresql/*/main/pg_hba.conf | head -1)
echo "$PGHBA"
# z. B. /etc/postgresql/15/main/pg_hba.conf

# Regel für das gesamte LAN zulassen (scram-sha-256):
grep -q "192.168.178.0/24" "$PGHBA" \
  || echo "host health naehrstoff 192.168.178.0/24 scram-sha-256" >> "$PGHBA"

# Kontrolle (die neue Zeile muss auftauchen):
tail -5 "$PGHBA"
```

> Schmaler zulassen geht auch: `host health naehrstoff 192.168.178.106/32 scram-sha-256`.

Zusätzlich sicherstellen, dass PostgreSQL auf allen Interfaces lauscht
(`postgresql.conf`):

```bash
PGCONF=$(ls /etc/postgresql/*/main/postgresql.conf | head -1)
grep -q "^listen_addresses" "$PGCONF" \
  || echo "listen_addresses = '*'" >> "$PGCONF"
# falls die Zeile auskommentiert existiert (mit führendem #), stattdessen
# manuell anpassen: listen_addresses = '*'
```

### 5.3 Konfiguration neu laden

```bash
pg_ctlcluster 15 reload
# oder bei anderer Major-Version:
# pg_ctlcluster <version> reload
```

### 5.4 Verbindung vom App-Container testen (optional, nach Schritt 2)

Vom Proxmox-Host in den App-Container wechseln und testen:

```bash
pct enter 106
apt -y install postgresql-client
PGPASSWORD='<sicheres-passwort>' psql -h 192.168.178.12 -U naehrstoff -d health -c "SELECT 1;"
# erwartet: eine Zeile mit 1
exit
```

tsdb-Container verlassen:
```bash
# falls du noch im CT 112 bist:
exit
```

---

## 6) App bauen und starten

**Im App-Container CT 106:**

```bash
pct enter 106
cd /opt/naehrstoffe-aus-foto
docker compose up -d --build
```

Das Build baut das Frontend (Vite) und Backend in ein Image und startet den
Container `naehrstoff-foto` (Port 8787, Volume `./data`).

### 6.1 Logs prüfen

```bash
docker compose logs -f
```

Erwartete Zeile beim Start (DB konfiguriert & erreichbar):
```
TimescaleDB: verbunden
```

bzw. über den Health-Endpoint:
```bash
docker compose exec naehrstoff wget -qO- http://localhost:8787/api/health
```

Erwartet ein JSON, in dem `timescale: true` (und `mistral: true`) steht.

Container-Status:
```bash
docker compose ps
docker ps
```

Container verlassen:
```bash
exit
```

---

## 7) Caddy in CT 104 + Cloudflare Public Hostname

Der Reverse Proxy läuft im **CT 104** (Caddy + Cloudflare-Tunnel). TLS übernimmt
der Tunnel bzw. Caddy; die App selbst spricht HTTP.

### 7.1 Caddy-Block ergänzen

**In CT 104:**

```bash
pct enter 104
```

Caddyfile öffnen (Pfad je nach Setup, z. B. `/etc/caddy/Caddyfile`):

```bash
nano /etc/caddy/Caddyfile
```

Neuen Block anhängen (Subdomain durch echte des Users ersetzen):

```caddyfile
naehrstoff.deine-domain.de {
    # Fotos können groß sein (bis ~25 MB)
    request_body {
        max_size 25MB
    }

    reverse_proxy 192.168.178.106:8787 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

> Falls Caddy hier bereits TLS selbst terminiert (lokales Zertifikat) UND der
> Cloudflare-Tunnel vorgeschaltet ist: sicherstellen, dass der Tunnel im
> Cloudflare-Dashboard auf `http://<caddy-ip>:80` (bzw. den internen Caddy-Port)
> zeigt und Caddy nur intern lauscht. Im Standardfall terminiert der Tunnel
> TLS und reicht an Caddy weiter, Caddy wiederum reverse-proxied an CT 106.

Caddy neu laden:

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
# bzw. caddy reload --config /etc/caddy/Caddyfile
```

CT 104 verlassen:
```bash
exit
```

### 7.2 Cloudflare-Tunnel: Public Hostname anlegen

Im **Cloudflare-Dashboard** (Zero Trust → Networks → Tunnels):

1. Bestehenden Tunnel (der zu CT 104 gehört) auswählen → **Configure**.
2. Reiter **Public Hostname** → **Add a public hostname**.
3. Felder:
   - **Subdomain**: `naehrstoff` (oder gewünschte Subdomain)
   - **Domain**: eigene Domain (z. B. `deine-domain.de`)
   - **Type**: `HTTP`
   - **URL**: interne Adresse des Caddy in CT 104, z. B. `192.168.178.104:80`
     (bzw. den Port, auf dem Caddy intern lauscht)
4. **Save hostname**.

> Die öffentliche URL ergibt sich zu `https://naehrstoff.deine-domain.de`.
> Dieser Wert muss exakt mit `GOOGLE_REDIRECT_URI` und `CORS_ORIGIN` in der
> `.env` übereinstimmen (Schritt 4).

---

## 8) Health-Check + ggf. Google OAuth

**Vom Proxmox-Host** (oder jedem Rechner im LAN) prüfen:

```bash
curl -s http://192.168.178.106:8787/api/health | head
```

Erwartet ein JSON mit:
- `mistral: true` (Key erkannt)
- `timescale: true` (DB verbunden)
- `drive: true/false` (`true` nur, wenn Google-Drive-Credentials gesetzt und
  OAuth bereits einmal durchlaufen wurde; vor erstem OAuth evtl. `false`)

### 8.1 Google OAuth einmalig durchlaufen (nur falls Drive genutzt)

Im Browser die App öffnen: `https://naehrstoff.deine-domain.de`

Im Frontend („Heute"-Tab) **Google Drive verbinden** klicken → OAuth-Flow
durchlaufen. Danach landen CSVs im konfigurierten Drive-Ordner und
`/api/health` zeigt `drive: true`.

> Voraussetzung: In der Google Cloud Console muss die Redirect-URI
> `https://naehrstoff.deine-domain.de/oauth/google/callback` unter dem
> OAuth-Client hinterlegt sein.

---

## 9) App im Browser nutzen (PWA, FaceID)

1. App öffnen: `https://naehrstoff.deine-domain.de`
2. Auf dem iPhone/Android: **„Zum Home-Bildschirm hinzufügen"** → installiert als PWA.
3. **FaceID einrichten**: beim ersten Öffnen „Gesichtserkennung einrichten" →
   WebAuthn registriert geräte-lokal (Biometrie-Daten verlassen nie das Gerät).
4. Foto vom Essen aufnehmen → Lebensmittel werden erkannt, Portionsgrößen ggf.
   korrigieren, Speichern. Daten landen parallel in JSON (Cache) und in der
   TimescaleDB (`nutrition_log`); optional zusätzlich als CSV in Google Drive.
5. CSV-Download pro Mahlzeit oder Bulk-Sync zu Drive.

> WebAuthn (FaceID) und Kamera erfordern HTTPS — über den Cloudflare-Tunnel
> gegeben. Lokal/HTTP nur zu Testzwecken (localhost ist exempt).

---

## Fehlersuche

| Problem | Mögliche Ursache | Lösung |
|---|---|---|
| `pct create` schlägt fehl / Template nicht gefunden | falscher Templatename | `pveam list local` exakten Namen prüfen (12.12, nicht 12.2); ggf. `pveam download local <name>` |
| Docker startet nicht im LXC | `nesting=1` fehlt | `pct set 106 --features nesting=1` dann `pct reboot 106` |
| `docker compose` unbekannt | nur altes `docker-compose` (V1) | `docker-compose-plugin` installieren (V2) oder `docker-compose` (V1) nutzen |
| Build schlägt fehl: kein Platz | rootfs zu klein | `pct resize 106 rootfs +8G` |
| App startet nicht / Port belegt | 8787 schon vergeben | `docker compose ps`, ggf. `docker compose down` und neu |
| `/api/health` meldet `timescale: false` | DB nicht erreichbar / falsche Credentials | `.env`-DB-Werte prüfen; `pg_hba.conf`-Regel; `listen_addresses='*'`; Verbindung testen (Schritt 5.4) |
| `TimescaleDB: verbunden` fehlt in Logs | PGHOST/PGPASSWORD/DATABASE_URL falsch | wie oben; `docker compose logs` auf Verbindungsfehler prüfen |
| `psql: FATAL: no pg_hba.conf entry` | LAN-Regel fehlt / Netz zu eng | `host health naehrstoff 192.168.178.0/24 scram-sha-256` in `pg_hba.conf`, `pg_ctlcluster reload` |
| `mistral: false` im Health | `MISTRAL_API_KEY` leer | `.env`-Wert prüfen, Container neu starten: `docker compose up -d` |
| `drive: false` (und gewünscht) | OAuth noch nicht durchlaufen | OAuth-Flow im Browser (Schritt 8.1); Redirect-URI in Google Console prüfen |
| Caddy 502/Connection refused | App nicht erreichbar | `curl http://192.168.178.106:8787/api/health`; `docker compose ps` im CT 106 |
| 413 Request Entity Too Large beim Foto | Body-Limit zu klein | Caddy `request_body { max_size 25MB }`; Cloudflare-Tunnel ggf. Upload-Limit prüfen |
| Cloudflare: Tunnel host nicht erreichbar | falsche interne URL im Tunnel | Public Hostname URL = interner Caddy-Endpunkt (z. B. `192.168.178.104:80`); Caddy lauscht intern |
| CORS-Fehler im Browser | `CORS_ORIGIN` passt nicht zur öffentlichen URL | `CORS_ORIGIN=https://naehrstoff.deine-domain.de` in `.env`, `docker compose up -d` |
| FaceID/Kamera funktioniert nicht | kein HTTPS / nicht-sicherer Kontext | nur über `https://naehrstoff.deine-domain.de` nutzen (Tunnel/Caddy) |
| App-Update | neue Repo-Version | im CT 106: `cd /opt/naehrstoffe-aus-foto && git pull && docker compose up -d --build` |

---

## Wartung (im CT 106)

```bash
pct enter 106
cd /opt/naehrstoffe-aus-foto

# Update
git pull && docker compose up -d --build

# Logs
docker compose logs -f

# Health
curl -s http://localhost:8787/api/health

# Stop / Start
docker compose down
docker compose up -d
exit
```

DB-Wartung (im CT 112):
```bash
pct enter 112
psql -U naehrstoff -d health -c "SELECT count(*) FROM nutrition_log;"
exit
```
