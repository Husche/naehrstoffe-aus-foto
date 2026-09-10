import { useEffect, useMemo, useState } from "react";
import type { FoodItem, Meal, AnalyzeResponse } from "./types.ts";
import {
  MACRO_KEYS,
  MACRO_LABELS,
  MICRO_KEYS,
  emptyFoodItem,
  rescaleItem,
} from "./types.ts";
import {
  analyzePhoto,
  downloadCsv,
  getDriveAuthUrl,
  getDriveStatus,
  getHealth,
  uploadToDrive,
  getServerMeals,
  saveServerMeal,
  deleteServerMeal,
} from "./api.ts";
import {
  getAllMeals,
  saveMeal,
  deleteMeal,
  getUnsyncedMeals,
  markSynced,
} from "./storage.ts";
import { faceIdAvailable, isRegistered, register, verify, webauthnSupported } from "./auth.ts";
import { compressImage } from "./image.ts";

type View = "capture" | "today" | "history";

function genId() {
  return `meal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function applyTheme(theme: string) {
  const root = document.documentElement;
  const dark = theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "dark" : "light");
}

function cycleTheme(t: string): string {
  if (t === "auto") return "light";
  if (t === "light") return "dark";
  return "auto";
}

function sumKey(items: FoodItem[], key: keyof FoodItem): number {
  return items.reduce((a, it) => a + (Number(it[key]) || 0), 0);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function isSameDay(a: string, b: Date) {
  const d = new Date(a);
  return (
    d.getFullYear() === b.getFullYear() &&
    d.getMonth() === b.getMonth() &&
    d.getDate() === b.getDate()
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<View>("capture");
  const [health, setHealth] = useState<{ mistral: boolean; drive: boolean } | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [draft, setDraft] = useState<Meal | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [webauthnOk, setWebauthnOk] = useState(false);
  const [faceId, setFaceId] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [undo, setUndo] = useState<{ meal: Meal } | null>(null);
  const [theme, setTheme] = useState(() => (localStorage.getItem("naehrstoff_theme") as string) || "auto");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    getHealth().then((h) => setHealth({ mistral: h.mistral, drive: h.drive })).catch(() => setHealth({ mistral: false, drive: false }));
    getDriveStatus().then(setDriveConnected).catch(() => {});
    refreshMeals();
    webauthnSupported() && setWebauthnOk(true);
    faceIdAvailable().then(setFaceId).catch(() => setFaceId(false));
    if (!isRegistered()) setLoggedIn(true);
  }, []);

  // Online/Offline-Status verfolgen.
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Drive-Status periodisch prüfen (alle 30s), damit OAuth-Verbindung erkannt wird.
  useEffect(() => {
    const t = setInterval(() => getDriveStatus().then(setDriveConnected).catch(() => {}), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const handler = () => { if (navigator.onLine) trySync(); };
    window.addEventListener("online", handler);
    if (navigator.onLine) trySync();
    return () => window.removeEventListener("online", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveConnected]);

  async function refreshMeals() {
    const local = await getAllMeals();
    let merged = local;
    // Server-Mahlzeiten mergen (Multi-Gerät), wenn online.
    if (navigator.onLine) {
      try {
        const server = await getServerMeals();
        const byId = new Map(local.map((m) => [m.meal_id, m]));
        for (const sm of server) {
          const lm = byId.get(sm.meal_id);
          // Server gewinnt, wenn neuer oder lokal noch nicht vorhanden.
          if (!lm || (sm.timestamp || "") > (lm.timestamp || "")) {
            byId.set(sm.meal_id, sm);
          }
        }
        merged = [...byId.values()];
      } catch {
        /* offline/Server nicht erreichbar: nur lokale verwenden */
      }
    }
    merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    setMeals(merged);
  }

  async function handleLogin() {
    setError(null);
    const ok = await verify();
    if (ok) {
      setLoggedIn(true);
      refreshMeals();
    } else {
      setError("Gesichtserkennung fehlgeschlagen oder abgebrochen.");
    }
  }

  async function handleRegister() {
    const ok = await register();
    if (ok) {
      setLoggedIn(true);
    } else {
      setError("Einrichtung fehlgeschlagen.");
    }
  }

  async function onPickFile(file: File) {
    setError(null);
    setLoading(true);
    setSyncMsg(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    try {
      const compressed = await compressImage(file);
      const res: AnalyzeResponse = await analyzePhoto(compressed);
      const items = res.items.length ? res.items : [];
      const beer = res.beer_detected || items.some((i) => i.is_beer);
      setDraft({
        meal_id: genId(),
        timestamp: new Date().toISOString(),
        items,
        beer_flag: beer,
        sanity_issues: res.sanity_issues || [],
        synced: false,
      });
    } catch (e: any) {
      setError(e.message || "Analyse fehlgeschlagen.");
    } finally {
      setLoading(false);
    }
  }

  function updatePortion(idx: number, value: number) {
    if (!draft) return;
    const items = [...draft.items];
    items[idx] = rescaleItem({ ...items[idx], portion_g: value });
    setDraft({ ...draft, items });
  }

  function removeItem(idx: number) {
    if (!draft) return;
    const items = draft.items.filter((_, i) => i !== idx);
    setDraft({ ...draft, items });
  }

  function addItem() {
    if (!draft) return;
    setDraft({ ...draft, items: [...draft.items, emptyFoodItem("")] });
  }

  function editItemName(idx: number, name: string) {
    if (!draft) return;
    const items = [...draft.items];
    items[idx] = { ...items[idx], name };
    setDraft({ ...draft, items });
  }

  async function saveMealLocal() {
    if (!draft) return;
    if (!draft.items.length) {
      setError("Keine Lebensmittel. Füge mindestens eines hinzu.");
      return;
    }
    try {
      await saveMeal(draft);
      // Auch serverseitig persistieren (Multi-Gerät), wenn online.
      if (navigator.onLine) {
        saveServerMeal(draft).catch((e) => console.warn("Server-Save fehlgeschlagen:", e));
      }
      setSyncMsg("Mahlzeit lokal gespeichert." + (navigator.onLine ? "" : " Wird synchronisiert, wenn online."));
      setDraft(null);
      setPreview(null);
      refreshMeals();
    } catch (e: any) {
      setError(e.message || "Speichern fehlgeschlagen.");
    }
  }

  async function handleDownloadCsv(meal: Meal) {
    setError(null);
    try {
      const blob = await downloadCsv(meal);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `naehrstoffe_${meal.meal_id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || "CSV-Download fehlgeschlagen.");
    }
  }

  async function connectDrive() {
    setError(null);
    try {
      const url = await getDriveAuthUrl();
      window.open(url, "_blank");
      setTimeout(() => getDriveStatus().then(setDriveConnected), 3000);
    } catch (e: any) {
      setError(e.message || "Google Drive konnte nicht verbunden werden.");
    }
  }

  async function trySync() {
    const unsynced = await getUnsyncedMeals();
    if (!unsynced.length) return;
    if (!driveConnected) return;
    let ok = 0;
    for (const m of unsynced) {
      try {
        await uploadToDrive(m);
        await markSynced(m.meal_id);
        ok++;
      } catch (e) {
        console.warn("Sync fehlgeschlagen für", m.meal_id, e);
      }
    }
    if (ok) {
      setSyncMsg(`${ok} Mahlzeit(en) mit Google Drive synchronisiert.`);
      refreshMeals();
    }
  }

  async function syncNow(meal: Meal) {
    setError(null);
    try {
      await uploadToDrive(meal);
      await markSynced(meal.meal_id);
      setSyncMsg("Hochgeladen zu Google Drive ✓");
      refreshMeals();
    } catch (e: any) {
      setError(e.message || "Drive-Upload fehlgeschlagen.");
    }
  }

  async function removeMeal(id: string) {
    try {
      const meals = await getAllMeals();
      const meal = meals.find((m) => m.meal_id === id);
      await deleteMeal(id);
      if (navigator.onLine) {
        deleteServerMeal(id).catch((e) => console.warn("Server-Delete fehlgeschlagen:", e));
      }
      refreshMeals();
      if (meal) {
        setUndo({ meal });
        setTimeout(() => setUndo(null), 6000);
      }
    } catch (e: any) {
      setError(e.message || "Löschen fehlgeschlagen.");
    }
  }

  async function undoDelete() {
    if (!undo) return;
    try {
      await saveMeal(undo.meal);
      if (navigator.onLine) {
        saveServerMeal(undo.meal).catch((e) => console.warn("Server-Undo fehlgeschlagen:", e));
      }
      setUndo(null);
      refreshMeals();
    } catch (e: any) {
      setError(e.message || "Wiederherstellen fehlgeschlagen.");
    }
  }

  const todayMeals = useMemo(
    () => meals.filter((m) => isSameDay(m.timestamp, new Date())),
    [meals]
  );

  const todayItems = useMemo(() => todayMeals.flatMap((m) => m.items), [todayMeals]);

  const todayTotals = useMemo(() => {
    return MACRO_KEYS.reduce((acc, k) => {
      acc[k] = sumKey(todayItems, k as keyof FoodItem);
      return acc;
    }, {} as Record<string, number>);
  }, [todayItems]);

  const last7 = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() - 7);
    return meals.filter((m) => new Date(m.timestamp) >= cutoff);
  }, [meals]);

  const grouped7 = useMemo(() => {
    const map = new Map<string, Meal[]>();
    for (const m of last7) {
      const key = fmtDate(m.timestamp);
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return [...map.entries()];
  }, [last7]);

  if (!loggedIn) {
    return (
      <LoginScreen
        faceId={faceId}
        webauthnOk={webauthnOk}
        onLogin={handleLogin}
        onRegister={handleRegister}
        error={error}
      />
    );
  }

  return (
    <div>
      <header className="app-header">
        <h1>🍽️ Nährstoffe aus Foto</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="theme-toggle"
            aria-label={`Design: ${theme}`}
            onClick={() => {
              const next = cycleTheme(theme);
              setTheme(next);
              localStorage.setItem("naehrstoff_theme", next);
            }}
          >
            {theme === "auto" ? "🌙" : theme === "light" ? "☀️" : "🌓"}
          </button>
          <nav className="nav">
            <button className={view === "capture" ? "active" : ""} onClick={() => setView("capture")}>Foto</button>
            <button className={view === "today" ? "active" : ""} onClick={() => setView("today")}>Heute</button>
            <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>Historie</button>
          </nav>
        </div>
      </header>

      <main className="container">
        {!online && (
          <div className="error-banner" style={{ background: "#fff3e0", borderColor: "#ffcc80", color: "#8a6d00" }}>
            📴 Offline – Mahlzeiten werden lokal gespeichert und synchronisiert, wenn wieder online.
          </div>
        )}
        {health && !health.mistral && (
          <div className="error-banner">
            ⚠️ Mistral API-Key fehlt im Backend. Fotos können nicht analysiert werden.
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        {syncMsg && (
          <div className="sanity" style={{ background: "#e6f0ec", color: "#0b3d2e", borderColor: "#2e8b57" }}>
            {syncMsg}
          </div>
        )}
        {undo && (
          <div className="undo-toast">
            <span>Mahlzeit gelöscht</span>
            <button onClick={undoDelete}>Rückgängig</button>
          </div>
        )}

        {view === "capture" && (
          <CaptureView
            loading={loading}
            preview={preview}
            onPickFile={onPickFile}
            draft={draft}
            updatePortion={updatePortion}
            removeItem={removeItem}
            addItem={addItem}
            editItemName={editItemName}
            setBeer={(b: boolean) => draft && setDraft({ ...draft, beer_flag: b })}
            saveMealLocal={saveMealLocal}
            onDiscard={() => { setDraft(null); setPreview(null); setError(null); }}
          />
        )}

        {view === "today" && (
          <TodayView
            todayMeals={todayMeals}
            todayItems={todayItems}
            totals={todayTotals}
            onDownload={handleDownloadCsv}
            onSync={syncNow}
            onRemove={removeMeal}
            driveConnected={driveConnected}
            connectDrive={connectDrive}
          />
        )}

        {view === "history" && (
          <HistoryView
            groups={grouped7}
            onRemove={removeMeal}
          />
        )}
      </main>
    </div>
  );
}

function LoginScreen({
  faceId,
  webauthnOk,
  onLogin,
  onRegister,
  error,
}: {
  faceId: boolean;
  webauthnOk: boolean;
  onLogin: () => void;
  onRegister: () => void;
  error: string | null;
}) {
  return (
    <div className="login-screen">
      <div style={{ fontSize: 48 }}>🍽️</div>
      <h2>Nährstoffe aus Foto</h2>
      <p>
        Mobile Nährstoffschätzung aus Mahlzeiten-Fotos. Bitte mit {faceId ? "Face ID" : "Gesichtserkennung"} entsperren.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {!webauthnOk && (
        <p style={{ color: "var(--danger)" }}>
          Dein Browser unterstützt keine Gesichtserkennung (WebAuthn). Du kannst die App trotzdem nutzen.
        </p>
      )}
      {isRegistered() ? (
        <button onClick={onLogin}>Entsperren</button>
      ) : (
        <button onClick={onRegister}>Gesichtserkennung einrichten</button>
      )}
      <button
        className="ghost"
        onClick={onLogin}
        style={{ marginTop: 4, fontSize: 14 }}
      >
        Überspringen
      </button>
    </div>
  );
}

function CaptureView({
  loading,
  preview,
  onPickFile,
  draft,
  updatePortion,
  removeItem,
  addItem,
  editItemName,
  setBeer,
  saveMealLocal,
  onDiscard,
}: any) {
  return (
    <div>
      {!draft && (
        <div className="camera-section">
          {loading ? (
            <div className="loading">
              <span className="spinner" /> Analysiere Foto…
            </div>
          ) : (
            <>
              <button
                className="camera-btn"
                aria-label="Foto mit Kamera aufnehmen"
                onClick={() => document.getElementById("cam-input")?.click()}
              >
                <span className="icon" aria-hidden="true">📷</span>
                Foto aufnehmen
              </button>
              <button
                className="upload-btn"
                aria-label="Bild aus Galerie auswählen"
                onClick={() => document.getElementById("upload-input")?.click()}
              >
                <span aria-hidden="true">📁</span> Bild auswählen
              </button>
              {preview && <img src={preview} className="preview" alt="Vorschau des aufgenommenen Essens" />}
              <input id="cam-input" type="file" accept="image/*" capture="environment" aria-label="Kamera-Foto auswählen" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }} />
              <input id="upload-input" type="file" accept="image/*" aria-label="Bild aus Galerie auswählen" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickFile(f); e.target.value = ""; }} />
            </>
          )}
        </div>
      )}

      {draft && (
        <div className="card">
          {preview && <img src={preview} className="preview" alt="Vorschau" />}
          <h3>Erkannte Lebensmittel</h3>
          {draft.sanity_issues?.length > 0 && (
            <div className="sanity">
              <strong>⚠️ Sanity Check:</strong>
              <ul>
                {draft.sanity_issues.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {draft.items.map((it: FoodItem, i: number) => (
            <div className="item-row" key={i}>
              <div className="row-head">
                <input
                  className="name"
                  value={it.name}
                  onChange={(e) => editItemName(i, e.target.value)}
                  placeholder="Lebensmittel"
                />
                <div className="portion">
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={it.portion_g}
                    onChange={(e) => updatePortion(i, Number(e.target.value) || 0)}
                  />
                  <span>g</span>
                </div>
                <button className="danger" aria-label="Lebensmittel entfernen" onClick={() => removeItem(i)} style={{ padding: "8px 12px", minHeight: 44 }}><span aria-hidden="true">✕</span></button>
              </div>
              <div className="nutrients">
                <span><b>{Math.round(it.kcal)}</b> kcal</span>
                <span>P: <b>{it.protein_g}g</b></span>
                <span>F: <b>{it.fat_g}g</b></span>
                <span>KH: <b>{it.carbs_g}g</b></span>
                <span>Ballast: <b>{it.fiber_g}g</b></span>
                <span style={{ fontSize: 11 }}>Quelle: {it.source}</span>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="ghost" onClick={addItem}>+ Lebensmittel hinzufügen</button>
          </div>

          <BeerToggle
            checked={draft.beer_flag}
            onChange={setBeer}
          />

          <div className="action-row">
            <button onClick={saveMealLocal}>💾 Speichern</button>
            <button className="ghost" onClick={onDiscard}>Verwerfen</button>
          </div>
        </div>
      )}
    </div>
  );
}

function BeerToggle({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <div className="beer-toggle">
      <div className="label">
        <span aria-hidden="true">🍺</span> Alkohol heute
        <small>Beer-Flag für deine Pipeline</small>
      </div>
      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          aria-label="Alkohol-Flag aktivieren"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="slider" />
      </label>
    </div>
  );
}

function TodayView({
  todayMeals,
  todayItems,
  totals,
  onDownload,
  onSync,
  onRemove,
  driveConnected,
  connectDrive,
}: any) {
  return (
    <div>
      <div className="card">
        <h3>Heute – Tagesübersicht</h3>
        <div className="macro-summary">
          {MACRO_KEYS.map((k) => (
            <div className="m" key={k}>
              <div className="v">{Math.round(totals[k] || 0)}</div>
              <div className="l">{MACRO_LABELS[k].split(" ")[0]}</div>
            </div>
          ))}
        </div>
        <div className="micro-grid">
          {MICRO_KEYS.slice(0, 8).map((k) => (
            <div key={k}>
              <span>{MACRO_LABELS[k]}</span>
              <b>{Math.round(sumKey(todayItems, k as keyof FoodItem) * 100) / 100}</b>
            </div>
          ))}
        </div>
      </div>

      {!driveConnected && (
        <div className="card">
          <p>Google Drive noch nicht verbunden.</p>
          <button onClick={connectDrive}>Mit Google Drive verbinden</button>
        </div>
      )}

      {todayMeals.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          Noch keine Mahlzeit heute. Mach ein Foto!
        </div>
      )}

      {todayMeals.map((m: Meal) => (
        <div className="card" key={m.meal_id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{fmtTime(m.timestamp)} Uhr</strong>
            {m.synced ? (
              <span className="synced-badge">synchronisiert</span>
            ) : (
              <span className="pending-badge">offline</span>
            )}
          </div>
          <div style={{ margin: "8px 0" }}>
            {m.items.map((it, i) => (
              <div key={i} style={{ fontSize: 14 }}>
                {it.name} – {it.portion_g}g · {Math.round(it.kcal)} kcal
              </div>
            ))}
          </div>
          {m.beer_flag && <div style={{ color: "var(--beer)", fontSize: 14 }}>🍺 Alkohol-Flag aktiv</div>}
          <div className="action-row">
            <button className="ghost" onClick={() => onDownload(m)}>⬇️ CSV</button>
            {driveConnected && !m.synced && (
              <button onClick={() => onSync(m)}>☁️ Sync Drive</button>
            )}
            <button className="danger" onClick={() => onRemove(m.meal_id)}>Löschen</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryView({ groups, onRemove }: { groups: [string, Meal[]][]; onRemove: (id: string) => void }) {
  return (
    <div>
      <h3 style={{ color: "var(--muted)", marginBottom: 8 }}>Letzte 7 Tage</h3>
      {groups.length === 0 && (
        <div className="card" style={{ textAlign: "center", color: "var(--muted)" }}>
          Noch keine Historie vorhanden.
        </div>
      )}
      {groups.map(([day, ms]) => (
        <div className="day-group" key={day}>
          <h3>{day}</h3>
          <div className="card">
            {ms.map((m) => {
              const kcal = sumKey(m.items, "kcal");
              return (
                <div className="history-item" key={m.meal_id}>
                  <div>
                    <div className="time">{fmtTime(m.timestamp)} Uhr</div>
                    <div className="items">
                      {m.items.map((it, i) => it.name).join(", ") || "—"}
                      {m.beer_flag && " 🍺"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="kcal">{Math.round(kcal)} kcal</div>
                    {m.synced ? (
                      <span className="synced-badge">sync</span>
                    ) : (
                      <span className="pending-badge">offline</span>
                    )}
                    <div style={{ marginTop: 6 }}>
                      <button className="danger" style={{ padding: "4px 8px", fontSize: 12 }} onClick={() => onRemove(m.meal_id)}>Löschen</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
