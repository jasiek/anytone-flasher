import { parseFirmware, type FirmwareImage } from "./format";

// public/firmware/manifest.json is written by scripts/add-firmware.ts.

export interface FirmwareEntry {
  /** Matches RadioModel.id. */
  modelId: string;
  version: string;
  /** Release date (YYYY-MM-DD) from the vendor file name. */
  date: string | null;
  firmwareModel: string;
  hwVersion: string;
  startAddress: number;
  /** Bytes flashed (the declared image size). */
  size: number;
  /** SHA-256 of the flashed bytes. */
  sha256: string;
  /** Paths relative to the manifest. */
  files: { spi: string; cdi: string; cdd: string };
  notes?: string;
}

export interface Manifest {
  firmware: FirmwareEntry[];
}

const manifestUrl = new URL("firmware/manifest.json", document.baseURI);

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Could not load firmware list (${res.status})`);
  return res.json();
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(new URL(path, manifestUrl));
  if (!res.ok) throw new Error(`Could not download ${path} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downloads, verifies and parses a bundled firmware. */
export async function loadFirmware(entry: FirmwareEntry): Promise<FirmwareImage> {
  const [spi, cdi, cdd] = await Promise.all([
    fetchBytes(entry.files.spi),
    fetchBytes(entry.files.cdi),
    fetchBytes(entry.files.cdd),
  ]);
  const image = parseFirmware(spi, cdi, cdd);
  const hash = await sha256(image.data);
  if (hash !== entry.sha256) throw new Error(`Firmware image checksum mismatch (got ${hash})`);
  if (image.model !== entry.firmwareModel || image.startAddress !== entry.startAddress) {
    throw new Error("Firmware files do not match the manifest");
  }
  return image;
}
