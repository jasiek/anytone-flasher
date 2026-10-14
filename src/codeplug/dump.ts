// Raw codeplug backup: every region in the model's map, read verbatim.
//
// File layout (all integers little-endian):
//   "ATCPDUMP"            8-byte magic
//   u32 format version    (1)
//   u32 header length     N
//   header                N bytes of UTF-8 JSON (DumpHeader)
//   data                  regions concatenated in header order
//
// This is not a CPS .rdt file. It keeps the radio's memory so it can be
// written back (or decoded) by a tool that understands the layout.

import type { DeviceIdent } from "../protocol/anytone";
import { hex } from "../protocol/anytone";
import { READ_BLOCK, type ProgramSession } from "../protocol/program";

export interface CodeplugRegion {
  name: string;
  address: number;
  length: number;
}

export interface DumpHeader {
  tool: string;
  createdAt: string;
  model: string;
  hwVersion: string;
  ident: string;
  regions: (CodeplugRegion & { offset: number })[];
}

const MAGIC = "ATCPDUMP";
const FORMAT_VERSION = 1;

export interface DumpProgress {
  bytesRead: number;
  totalBytes: number;
  region: string;
}

export function totalSize(regions: CodeplugRegion[]) {
  return regions.reduce((n, r) => n + r.length, 0);
}

export async function readCodeplug(
  session: ProgramSession,
  regions: CodeplugRegion[],
  opts: { onProgress?: (p: DumpProgress) => void; signal?: AbortSignal; blockSize?: number } = {},
): Promise<{ header: DumpHeader; data: Uint8Array }> {
  const { onProgress = () => {}, signal, blockSize = READ_BLOCK } = opts;
  const total = totalSize(regions);
  const data = new Uint8Array(total);
  const placed: DumpHeader["regions"] = [];
  let offset = 0;
  let lastReport = 0;
  for (const r of regions) {
    placed.push({ ...r, offset });
    for (let i = 0; i < r.length; i += blockSize) {
      if (signal?.aborted) throw new Error("Aborted by user");
      const len = Math.min(blockSize, r.length - i);
      data.set(await session.readBlock(r.address + i, len), offset + i);
      const now = Date.now();
      if (now - lastReport > 50) {
        lastReport = now;
        onProgress({ bytesRead: offset + i + len, totalBytes: total, region: r.name });
      }
    }
    offset += r.length;
  }
  onProgress({ bytesRead: total, totalBytes: total, region: "" });
  const header: DumpHeader = {
    tool: "anytone-flasher",
    createdAt: new Date().toISOString(),
    model: session.ident.model,
    hwVersion: session.ident.hwVersion,
    ident: hex(session.ident.raw),
    regions: placed,
  };
  return { header, data };
}

export function encodeDump(header: DumpHeader, data: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(16 + json.length + data.length);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(MAGIC), 0);
  view.setUint32(8, FORMAT_VERSION, true);
  view.setUint32(12, json.length, true);
  out.set(json, 16);
  out.set(data, 16 + json.length);
  return out;
}

export function decodeDump(file: Uint8Array): { header: DumpHeader; data: Uint8Array } {
  if (new TextDecoder().decode(file.subarray(0, 8)) !== MAGIC) throw new Error("Not a codeplug dump");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const version = view.getUint32(8, true);
  if (version !== FORMAT_VERSION) throw new Error(`Unsupported dump format version ${version}`);
  const len = view.getUint32(12, true);
  const header: DumpHeader = JSON.parse(new TextDecoder().decode(file.subarray(16, 16 + len)));
  const data = file.subarray(16 + len);
  if (data.length !== totalSize(header.regions)) throw new Error("Dump is truncated");
  return { header, data };
}

export function dumpFileName(ident: DeviceIdent, date = new Date()) {
  const p = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `${ident.model}-codeplug-${stamp}.atdump`;
}

export function downloadFile(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
