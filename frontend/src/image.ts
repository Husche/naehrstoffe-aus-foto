// Clientseitige Bildkompression vor Upload.
// Bewusst konservativ: Erkennungsqualität für Mistral Vision hat Priorität.
// Skaliert auf max. 1600px (ausreichend für Lebensmittel-Erkennung) und JPEG 0.85.
// Bei 2-3 Fotos/Tag sind Bandbreite/Kosten vernachlässigbar; Kompression dient
// hauptsächlich dem Vermeiden über großer Handy-Kamerabilder (oft 12MP+, >5MB).
// EXIF-Orientierung wird korrigiert, damit iPhone-Hochkant-Fotos nicht gedreht ankommen.

const MAX_DIM = 1600;
const QUALITY = 0.85;
// Nur komprimieren wenn > 1MB; kleinere Bilder original an Mistral senden.
const MIN_SIZE = 1024 * 1024;

// EXIF-Orientierungs-Tag auslesen (JPEG-APP1-Segment).
// TIFF-Header: 2 Byte Byte-Order (II/MM), 2 Byte Magic (0x002A), 4 Byte IFD0-Offset (relativ zum TIFF-Start).
// IFD0: 2 Byte Eintragszahl, dann je 12 Byte Eintrag (Tag, Typ, Zaehler, Wert).
function readExifOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = new DataView(reader.result as ArrayBuffer);
        if (buf.byteLength < 2 || buf.getUint16(0) !== 0xffd8) return resolve(1);
        let offset = 2;
        let marker;
        while (offset + 2 <= buf.byteLength) {
          marker = buf.getUint16(offset);
          offset += 2;
          if (marker === 0xffe1) {
            // Nach dem Marker folgt die 2-Byte-Segmentlaenge, erst danach "Exif\0\0".
            // Ohne dieses Skip wuerde getUint32 auf die Laengen-Bytes zeigen und die
            // Exif-Magic niemals erkennen -> Orientierung waere immer 1 (korrigiert).
            if (offset + 2 > buf.byteLength) return resolve(1);
            offset += 2;
            if (offset + 4 > buf.byteLength || buf.getUint32(offset) !== 0x45786966) return resolve(1);
            offset += 6; // skip "Exif\0\0" -> jetzt am TIFF-Header
            const tiffStart = offset;
            if (tiffStart + 8 > buf.byteLength) return resolve(1);
            const little = buf.getUint16(tiffStart) === 0x4949;
            const ifd0 = tiffStart + buf.getUint32(tiffStart + 4, little);
            if (ifd0 + 2 > buf.byteLength) return resolve(1);
            const count = buf.getUint16(ifd0, little);
            for (let i = 0; i < count; i++) {
              const e = ifd0 + 2 + i * 12;
              if (e + 12 > buf.byteLength) break;
              if (buf.getUint16(e, little) === 0x0112) {
                return resolve(buf.getUint16(e + 8, little));
              }
            }
            return resolve(1);
          } else if ((marker & 0xff00) !== 0xff00) {
            return resolve(1);
          } else {
            if (offset + 2 > buf.byteLength) return resolve(1);
            offset += buf.getUint16(offset);
          }
        }
      } catch {
        /* ignore */
      }
      resolve(1);
    };
    reader.onerror = () => resolve(1);
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

// Canvas-Transformation je EXIF-Orientierung.
function applyOrientation(ctx: CanvasRenderingContext2D, orientation: number, width: number, height: number) {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, width, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, width, height); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, height); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, height, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, height, width); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, width); break;
    default: break;
  }
}

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size < MIN_SIZE) return file;

  try {
    const orientation = await readExifOrientation(file);
    const bitmap = await createImageBitmap(file);
    const rotated = orientation >= 5 && orientation <= 8;
    const srcW = rotated ? bitmap.height : bitmap.width;
    const srcH = rotated ? bitmap.width : bitmap.height;
    let outW = srcW;
    let outH = srcH;
    if (srcW > MAX_DIM || srcH > MAX_DIM) {
      const scale = MAX_DIM / Math.max(srcW, srcH);
      outW = Math.round(srcW * scale);
      outH = Math.round(srcH * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (orientation > 1) applyOrientation(ctx, orientation, outW, outH);
    ctx.drawImage(bitmap, 0, 0, outW, outH);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob) return file;
    if (blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
      type: "image/jpeg",
    });
  } catch {
    return file;
  }
}
