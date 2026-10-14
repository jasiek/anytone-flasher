// Bundles an official AnyTone firmware package into public/firmware.
//
//   npm run add-firmware -- <model-id> <path/to/file.spi> [--version 4.00] [--date 2025-07-25] [--notes "..."]
//
// The .CDI and .CDD must sit next to the .spi with the same base name.
// Files are validated with the same parser the app uses, copied to
// public/firmware/<model-id>/<version>/ and recorded in manifest.json.
// For radios with GD32/AT32 variants, add each build; the MCU is taken from
// the model tag (see firmwareTags in src/models.ts).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { FirmwareEntry, Manifest } from "../src/firmware/catalog.ts";
import { parseFirmware } from "../src/firmware/format.ts";
import { MODELS } from "../src/models.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const [v] = args.splice(i, 2).slice(1);
  return v;
};
const versionArg = flag("version");
const dateArg = flag("date");
const notes = flag("notes");
const [modelId, spiPath] = args;
if (!modelId || !spiPath) {
  console.error("usage: npm run add-firmware -- <model-id> <file.spi> [--version X] [--date YYYY-MM-DD] [--notes TEXT]");
  process.exit(1);
}

const model = MODELS.find((m) => m.id === modelId);
if (!model) throw new Error(`Unknown model "${modelId}". Known: ${MODELS.map((m) => m.id).join(", ")}`);

const base = spiPath.replace(/\.spi$/i, "");
const find = (ext: string) => {
  for (const p of [`${base}.${ext}`, `${base}.${ext.toLowerCase()}`]) if (existsSync(p)) return p;
  throw new Error(`Missing ${base}.${ext}`);
};
const cdiPath = find("CDI");
const cddPath = find("CDD");
const image = parseFirmware(readFileSync(spiPath), readFileSync(cdiPath), readFileSync(cddPath));
if (image.trailingBytes) {
  console.warn(`warning: .CDD has ${image.trailingBytes} bytes past the declared size; they will not be flashed`);
}
if (!(image.model in model.firmwareTags)) {
  throw new Error(
    `Package is for ${image.model}; ${model.id} accepts ${Object.keys(model.firmwareTags).join(", ")}`,
  );
}
const mcu = model.firmwareTags[image.model]!;
if (!model.hwVersions.includes(image.hwVersion)) {
  throw new Error(`Hardware ${image.hwVersion} is not listed for ${model.id} (${model.hwVersions.join(", ")})`);
}

// Vendor names look like D878UV_V4.00_20250725, D578UV_GD_V1.19.2_20230923 or D878UV_V1.10_2018-12-21.
const name = basename(base);
const m = /_V(\d+\.\d+(?:\.\d+)?[A-Za-z]?)_(\d{4})-?(\d{2})-?(\d{2})$/.exec(name);
const version = versionArg ?? m?.[1]?.toUpperCase();
if (!version) throw new Error(`Cannot infer version from "${name}"; pass --version`);
const date = dateArg ?? (m ? `${m[2]}-${m[3]}-${m[4]}` : null);

const root = join(import.meta.dirname, "..", "public", "firmware");
const dest = join(root, model.id, version);
mkdirSync(dest, { recursive: true });
const out = { spi: `${name}.spi`, cdi: `${name}.CDI`, cdd: `${name}.CDD` };
copyFileSync(spiPath, join(dest, out.spi));
copyFileSync(cdiPath, join(dest, out.cdi));
copyFileSync(cddPath, join(dest, out.cdd));

const manifestPath = join(root, "manifest.json");
const manifest: Manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { firmware: [] };
const rel = (f: string) => relative(dirname(manifestPath), join(dest, f)).split("\\").join("/");
const hash = createHash("sha256");
for (const s of image.segments) hash.update(s.data);
const entry: FirmwareEntry = {
  modelId: model.id,
  version,
  date,
  firmwareModel: image.model,
  mcu,
  hwVersion: image.hwVersion,
  segments: image.segments.map((s) => ({ address: s.address, size: s.data.length })),
  size: image.size,
  sha256: hash.digest("hex"),
  files: { spi: rel(out.spi), cdi: rel(out.cdi), cdd: rel(out.cdd) },
  ...(notes ? { notes } : {}),
};
manifest.firmware = manifest.firmware.filter(
  (f) => !(f.modelId === model.id && f.version === version && f.firmwareModel === image.model),
);
manifest.firmware.push(entry);
const modelOrder = (id: string) => MODELS.findIndex((x) => x.id === id);
manifest.firmware.sort(
  (a, b) =>
    modelOrder(a.modelId) - modelOrder(b.modelId) ||
    (b.date ?? "").localeCompare(a.date ?? "") ||
    b.version.localeCompare(a.version, undefined, { numeric: true }) ||
    (a.mcu ?? "").localeCompare(b.mcu ?? ""),
);
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const where = image.segments.map((s) => `0x${s.address.toString(16)}`).join(", ");
console.log(`Added ${model.id} ${version}${mcu ? ` (${mcu})` : ""}: ${image.size} bytes at ${where}`);
