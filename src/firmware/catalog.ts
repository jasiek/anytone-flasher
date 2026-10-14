import { MCU_LABEL, mcuFromUsbVendor, type Mcu } from "../models";
import { parseFirmware, type FirmwareImage } from "./format";

// public/firmware/manifest.json is written by scripts/add-firmware.ts.

export interface FirmwareEntry {
  /** Matches RadioModel.id. */
  modelId: string;
  version: string;
  /** Release date (YYYY-MM-DD) from the vendor file name. */
  date: string | null;
  /** Model tag from the .spi, e.g. "D578UVA". */
  firmwareModel: string;
  /** MCU this build is for; null if the radio has only one. */
  mcu: Mcu | null;
  hwVersion: string;
  segments: { address: number; size: number }[];
  /** Bytes flashed (sum of segment sizes). */
  size: number;
  /** SHA-256 of the flashed bytes, segments concatenated. */
  sha256: string;
  /** Paths relative to the manifest. */
  files: { spi: string; cdi: string; cdd: string };
  notes?: string;
}

export interface Manifest {
  firmware: FirmwareEntry[];
}

/** One firmware version of a model, possibly with a build per MCU. */
export interface FirmwareRelease {
  modelId: string;
  version: string;
  date: string | null;
  builds: FirmwareEntry[];
}

export function groupReleases(entries: FirmwareEntry[]): FirmwareRelease[] {
  const byKey = new Map<string, FirmwareRelease>();
  for (const e of entries) {
    const key = `${e.modelId}\0${e.version}`;
    let r = byKey.get(key);
    if (!r) {
      r = { modelId: e.modelId, version: e.version, date: e.date, builds: [] };
      byKey.set(key, r);
    }
    r.builds.push(e);
  }
  return [...byKey.values()];
}

const hexId = (n?: number) => (n ?? 0).toString(16).padStart(4, "0");

/**
 * Picks the build matching the radio's MCU, identified by the USB vendor ID
 * of its serial port. Throws if the MCU can't be told or has no build.
 */
export function selectBuild(release: FirmwareRelease, usbVendorId: number | undefined): FirmwareEntry {
  const { builds } = release;
  if (builds.length === 1 && builds[0]!.mcu === null) return builds[0]!;
  const mcu = mcuFromUsbVendor(usbVendorId);
  if (!mcu) {
    throw new Error(
      `Can't tell which processor this radio has (USB vendor ${hexId(usbVendorId)}), ` +
        `so the right V${release.version} build can't be chosen.`,
    );
  }
  const build = builds.find((b) => b.mcu === mcu || b.mcu === null);
  if (!build) {
    throw new Error(
      `This radio has an ${MCU_LABEL[mcu]} processor and V${release.version} has no ${MCU_LABEL[mcu]} build. ` +
        "Choose a newer version.",
    );
  }
  return build;
}

const manifestUrl = () => new URL("firmware/manifest.json", document.baseURI);

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(manifestUrl());
  if (!res.ok) throw new Error(`Could not load firmware list (${res.status})`);
  return res.json();
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(new URL(path, manifestUrl()));
  if (!res.ok) throw new Error(`Could not download ${path} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function sha256Segments(image: FirmwareImage): Promise<string> {
  const all = new Uint8Array(image.size);
  let off = 0;
  for (const s of image.segments) {
    all.set(s.data, off);
    off += s.data.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", all);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downloads, verifies and parses a bundled firmware build. */
export async function loadFirmware(entry: FirmwareEntry): Promise<FirmwareImage> {
  const [spi, cdi, cdd] = await Promise.all([
    fetchBytes(entry.files.spi),
    fetchBytes(entry.files.cdi),
    fetchBytes(entry.files.cdd),
  ]);
  const image = parseFirmware(spi, cdi, cdd);
  const hash = await sha256Segments(image);
  if (hash !== entry.sha256) throw new Error(`Firmware image checksum mismatch (got ${hash})`);
  const sameSegments =
    image.segments.length === entry.segments.length &&
    image.segments.every((s, i) => s.address === entry.segments[i]!.address && s.data.length === entry.segments[i]!.size);
  if (image.model !== entry.firmwareModel || !sameSegments) {
    throw new Error("Firmware files do not match the manifest");
  }
  return image;
}
