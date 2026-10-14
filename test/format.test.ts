import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FirmwareEntry, Manifest } from "../src/firmware/catalog";
import { FirmwareFormatError, parseFirmware, parseSpi } from "../src/firmware/format";
import { MODELS } from "../src/models";

const root = join(import.meta.dirname, "..", "public", "firmware");
const manifest: Manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const load = (p: string) => new Uint8Array(readFileSync(join(root, p)));
const find = (modelId: string, version: string, mcu: FirmwareEntry["mcu"] = null) =>
  manifest.firmware.find((x) => x.modelId === modelId && x.version === version && x.mcu === mcu)!;
const parse = (f: FirmwareEntry) => parseFirmware(load(f.files.spi), load(f.files.cdi), load(f.files.cdd));

describe("bundled firmware", () => {
  const label = (f: FirmwareEntry) => `${f.modelId} ${f.version}${f.mcu ? ` ${f.mcu}` : ""}`;
  it.each(manifest.firmware.map((f) => [label(f), f] as const))("%s parses and matches the manifest", (_, f) => {
    const img = parse(f);
    expect(img.model).toBe(f.firmwareModel);
    expect(img.hwVersion).toBe(f.hwVersion);
    expect(img.segments.map((s) => ({ address: s.address, size: s.data.length }))).toEqual(f.segments);
    expect(img.size).toBe(f.size);
    const h = createHash("sha256");
    for (const s of img.segments) h.update(s.data);
    expect(h.digest("hex")).toBe(f.sha256);

    // Each build's tag must belong to its model, with the matching MCU.
    const model = MODELS.find((m) => m.id === f.modelId)!;
    expect(model.firmwareTags[img.model]).toBe(f.mcu);
    // Every image starts with an ARM vector table: SP in SRAM, reset handler in flash.
    const v = new DataView(img.segments[0]!.data.buffer, img.segments[0]!.data.byteOffset);
    expect(v.getUint32(0, true) >>> 24).toBe(0x20);
    expect(v.getUint32(4, true) >>> 24).toBe(0x08);
  });

  it("has every release once per MCU", () => {
    const keys = manifest.firmware.map((f) => `${f.modelId} ${f.version} ${f.mcu}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads the D878UV V4.00 descriptor", () => {
    const f = find("d878uv", "4.00");
    expect(parseSpi(load(f.files.spi))).toEqual({ segmentCount: 1, model: "D878UV", hwVersion: "V100", imageSize: 931328 });
    expect(f.segments).toEqual([{ address: 0x08004000, size: 931328 }]);
  });

  it("reads 7-character model tags in full (D878UVII)", () => {
    expect(parseSpi(load(find("d878uv2", "4.00").files.spi)).model).toBe("D878UV2");
  });

  it("tags the D578UV Plus AT32 build as 578UV2A", () => {
    expect(find("d578uv2", "2.08", "at32").firmwareModel).toBe("578UV2A");
    expect(find("d578uv2", "2.08", "gd32").firmwareModel).toBe("D578UV2");
    expect(find("d578uv", "1.21", "at32").segments[0]!.address).toBe(0x08006000);
  });

  it("splits the two-segment D168UV image", () => {
    const img = parse(find("d168uv", "1.07"));
    expect(img.segments.map((s) => [s.address, s.data.length])).toEqual([
      [0x08004000, 0x1b0cc],
      [0x08020000, 0xc99dc],
    ]);
  });

  it("accepts the 50-byte .spi of D878UV V1.09", () => {
    const f = find("d878uv", "1.09");
    expect(load(f.files.spi).length).toBe(50);
    expect(parseSpi(load(f.files.spi))).toMatchObject({ model: "D878UV", hwVersion: "V100" });
  });

  it("ignores trailing bytes after the declared image (D878UV V3.08N)", () => {
    expect(parse(find("d878uv", "3.08N")).trailingBytes).toBe(132);
  });
});

describe("validation", () => {
  const f = find("d878uv", "4.00");
  const spi = load(f.files.spi);
  const cdi = load(f.files.cdi);
  const cdd = load(f.files.cdd);

  it("rejects a short image", () => {
    expect(() => parseFirmware(spi, cdi, cdd.subarray(0, 100))).toThrow(FirmwareFormatError);
  });

  it("rejects icon packages (14-byte .spi)", () => {
    expect(() => parseSpi(new Uint8Array(14))).toThrow(/51 bytes/);
  });

  it("rejects disagreeing model fields", () => {
    const bad = spi.slice();
    bad[26] = "X".charCodeAt(0);
    expect(() => parseSpi(bad)).toThrow(/model mismatch/);
  });

  it("rejects disagreeing hardware versions (as in D168UV V1.02)", () => {
    const bad = spi.slice();
    bad.set([..."V102"].map((c) => c.charCodeAt(0)), 42);
    expect(() => parseSpi(bad)).toThrow(/hardware version mismatch/);
  });

  it("rejects add-on board images (address outside MCU flash)", () => {
    const bad = cdi.slice();
    bad.set([0x00, 0x20, 0x00, 0x00], 256); // APRS/BT board package loads at 0x2000
    expect(() => parseFirmware(spi, bad, cdd)).toThrow(/not a radio firmware/);
  });

  it("rejects a segment count that doesn't match the .CDI", () => {
    const bad = spi.slice();
    bad[4] = 2;
    expect(() => parseFirmware(bad, cdi, cdd)).toThrow(/\.CDI must be 2/);
  });
});
