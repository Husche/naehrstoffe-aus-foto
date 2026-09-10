// WebAuthn-basiertes lokales Login (FaceID / TouchID / Gerät-PIN).
// Rein client-seitig, keine Biometrie-Daten verlassen das Gerät.
// Geräte-spezifischer Credential, im localStorage als "geräte-lokal" markiert.

const RP_NAME = "Nährstoffe aus Foto";

function bufToB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64ToBuf(b64: string): ArrayBuffer {
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const b64u = b64.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64u);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function webauthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials !== "undefined"
  );
}

export async function faceIdAvailable(): Promise<boolean> {
  if (!webauthnSupported()) return false;
  try {
    if (
      "isUserVerifyingPlatformAuthenticatorAvailable" in
      window.PublicKeyCredential
    ) {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function register(): Promise<boolean> {
  if (!webauthnSupported()) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const credId = `cred-${Date.now()}`;
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: RP_NAME,
          id: location.hostname === "localhost" ? "localhost" : location.hostname,
        },
        user: {
          id: userId,
          name: "Nutzer",
          displayName: "Nutzer",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "required",
        },
        timeout: 60000,
        attestation: "none",
      },
    } as CredentialCreationOptions);
    if (cred && "rawId" in cred) {
      localStorage.setItem(
        "naehrstoff_webauthn",
        JSON.stringify({
          id: (cred as PublicKeyCredential).id,
          rawId: bufToB64((cred as PublicKeyCredential).rawId),
          credMarker: credId,
        })
      );
      return true;
    }
  } catch (e) {
    console.warn("WebAuthn Registrierung fehlgeschlagen:", e);
  }
  return false;
}

export async function verify(): Promise<boolean> {
  if (!webauthnSupported()) return false;
  const stored = localStorage.getItem("naehrstoff_webauthn");
  if (!stored) return await register();
  const { rawId } = JSON.parse(stored);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required",
        allowCredentials: [
          { type: "public-key", id: b64ToBuf(rawId), transports: ["internal"] },
        ],
      },
    } as CredentialRequestOptions);
    return !!assertion;
  } catch (e) {
    console.warn("WebAuthn Verifikation fehlgeschlagen:", e);
    return false;
  }
}

export function isRegistered(): boolean {
  return !!localStorage.getItem("naehrstoff_webauthn");
}

export function logout() {
  localStorage.removeItem("naehrstoff_webauthn");
}
