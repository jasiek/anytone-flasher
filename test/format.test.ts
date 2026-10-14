import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FirmwareFormatError, parseFirmware, parseSpi } from "../src/firmware/format";
import type { Manifest } from "../src/firmware/catalog";
import { createHash } from "node:crypto";

const root = join(import.meta.dirname, "..", "public", "firmware");
const manifest: Manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const load = (p: string) => new Uint8Array(readFileSync(join(root, p)));

describe("bundled firmware", () => {
  it.each(manifest.firmware.map((f) => [`${f.modelId} ${f.version}`, f] as const))("%s parses and matches the manifest", (_, f) => {
    const img = parseFirmware(load(f.files.spi), load(f.files.cdi), load(f.files.cdd));
    expect(img.model).toBe(f.firmwareModel);
    expect(img.hwVersion).toBe(f.hwVersion);
    expect(img.startAddress).toBe(f.startAddress);
    expect(img.data.length).toBe(f.size);
    expect(createHash("sha256").update(img.data).digest("hex")).toBe(f.sha256);
  });

  it("reads the D878UV V4.00 descriptor", () => {
    const f = manifest.firmware.find((x) => x.version === "4.00")!;
    expect(parseSpi(load(f.files.spi))).toEqual({ model: "D878UV", hwVersion: "V100", imageSize: 931328 });
    expect(f.startAddress).toBe(0x08004000);
  });

  it("accepts the 50-byte .spi of V1.09", () => {
    const f = manifest.firmware.find((x) => x.version === "1.09")!;
    expect(load(f.files.spi).length).toBe(50);
    expect(parseSpi(load(f.files.spi))).toMatchObject({ model: "D878UV", hwVersion: "V100" });
  });

  it("truncates trailing bytes after the declared image (V3.08N)", () => {
    const f = manifest.firmware.find((x) => x.version === "3.08N")!;
    const img = parseFirmware(load(f.files.spi), load(f.files.cdi), load(f.files.cdd));
    expect(img.trailingBytes).toBe(132);
  });
});

describe("validation", () => {
  const f = manifest.firmware[0]!;
  const spi = load(f.files.spi);
  const cdi = load(f.files.cdi);
  const cdd = load(f.files.cdd);

  it("rejects a short image", () => {
    expect(() => parseFirmware(spi, cdi, cdd.subarray(0, 100))).toThrow(FirmwareFormatError);
  });

  it("rejects icon packages (14-byte .spi)", () => {
    expect(() => parseSpi(new Uint8Array(14))).toThrow(/51 bytes/);
  });

  it("rejects a model mismatch between descriptors", () => {
    const bad = cdi.slice();
    bad[0] = "X".charCodeAt(0);
    expect(() => parseFirmware(spi, bad, cdd)).toThrow(/Model mismatch/);
  });

  it("rejects a start address outside flash", () => {
    const bad = cdi.slice();
    bad[259] = 0x20;
    expect(() => parseFirmware(spi, bad, cdd)).toThrow(/outside STM32 flash/);
  });
});
