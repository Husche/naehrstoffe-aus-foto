// Ersetzt __APP_VERSION__ in dist/sw.js durch die package.json-Version
// beim Vite-Build, damit alte Service-Worker-Caches automatisch invalidiert werden.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, "package.json"), "utf-8"));
const swSrc = path.join(frontendRoot, "public", "sw.js");
const swDist = path.join(frontendRoot, "dist", "sw.js");
let content = fs.readFileSync(swSrc, "utf-8");
content = content.replace(/__APP_VERSION__/g, pkg.version);
fs.writeFileSync(swDist, content, "utf-8");
console.log(`sw.js versioniert: naehrstoff-v${pkg.version}`);
