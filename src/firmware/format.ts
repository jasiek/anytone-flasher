// AnyTone firmware packages ship as three files sharing a base name:
//
//   .spi  51-byte descriptor: segment count, total size, model tag, hardware version
//   .CDI  one 278-byte record per segment: image name, flash address, size, offset in .CDD
//   .CDD  the raw image(s), streamed to the radio as-is
//
// Layout derived from reald/anytone-flash-tools (firmware/flash_firmware.py)
// and checked against official D878UV, D878UVII, D578UV, D578UV Plus and
// D168UV packages. Most packages have one segment; the D168UV has two.

export const SPI_SIZE = 51;
/** D878UV V1.09 shipped a .spi without the final NUL byte. */
const SPI_SIZE_SHORT = 50;
export const CDI_RECORD_SIZE = 278;

export interface SpiInfo {
  segmentCount: number;
  /** Model tag, up to 8 characters, e.g. "D878UV", "D878UV2", "D578UVA". */
  model: string;
  /** 4-character hardware version, e.g. "V100". */
  hwVersion: string;
  /** Total .CDD bytes covered by all segments. */
  imageSize: number;
}

export interface CdiSegment {
  name: string;
  /** Flash address of the segment (MCU flash, 0x08xxxxxx). */
  address: number;
  size: number;
  /** Byte offset of the segment within the .CDD. */
  offset: number;
}

export interface FirmwareSegment {
  address: number;
  data: Uint8Array;
}

export interface FirmwareImage {
  model: string;
  hwVersion: string;
  segments: FirmwareSegment[];
  /** Sum of segment sizes: the bytes that get flashed. */
  size: number;
  /** Bytes in the .CDD past the last segment, which are ignored (see parseFirmware). */
  trailingBytes: number;
}

export class FirmwareFormatError extends Error {
  override name = "FirmwareFormatError";
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b);
const trimField = (b: Uint8Array) => ascii(b).replace(/\0[\s\S]*$/, "").trimEnd();

const u16le = (b: Uint8Array, off: number) => b[off]! | (b[off + 1]! << 8);
const u32le = (b: Uint8Array, off: number) =>
  ((b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0);

function expectBytes(buf: Uint8Array, off: number, expected: number[] | string, what: string) {
  const exp = typeof expected === "string" ? [...expected].map((c) => c.charCodeAt(0)) : expected;
  for (let i = 0; i < exp.length; i++) {
    if (buf[off + i] !== exp[i]) {
      throw new FirmwareFormatError(`Unexpected ${what} at offset ${off + i}`);
    }
  }
}

export function parseSpi(spi: Uint8Array): SpiInfo {
  if (spi.length !== SPI_SIZE && spi.length !== SPI_SIZE_SHORT) {
    throw new FirmwareFormatError(
      `.spi must be ${SPI_SIZE} bytes, got ${spi.length} (icon/other package types are not supported)`,
    );
  }
  expectBytes(spi, 0, [0x20, 0, 0, 0], ".spi header");
  expectBytes(spi, 10, [0, 0, 0, 0], ".spi padding");
  expectBytes(spi, 34, " ".repeat(8), ".spi padding");
  expectBytes(spi, 46, spi.length === SPI_SIZE ? [0x20, 0x20, 0x20, 0x20, 0] : [0x20, 0x20, 0x20, 0x20], ".spi trailer");

  const segmentCount = u16le(spi, 4);
  if (segmentCount < 1 || segmentCount > 8) {
    throw new FirmwareFormatError(`.spi declares ${segmentCount} segments`);
  }
  // The model tag is an 8-byte space-padded field (e.g. "D878UV  ", "D878UV2 ").
  const model = trimField(spi.subarray(14, 22));
  const model2 = trimField(spi.subarray(26, 34));
  const hwVersion = ascii(spi.subarray(22, 26));
  const hwVersion2 = ascii(spi.subarray(42, 46));
  if (!model) throw new FirmwareFormatError(".spi has no model tag");
  if (model !== model2) throw new FirmwareFormatError(`.spi model mismatch: ${model} / ${model2}`);
  if (hwVersion !== hwVersion2) {
    throw new FirmwareFormatError(`.spi hardware version mismatch: ${hwVersion} / ${hwVersion2}`);
  }
  return { segmentCount, model, hwVersion, imageSize: u32le(spi, 6) };
}

export function parseCdi(cdi: Uint8Array, segmentCount: number): CdiSegment[] {
  if (cdi.length !== segmentCount * CDI_RECORD_SIZE) {
    throw new FirmwareFormatError(`.CDI must be ${segmentCount} × ${CDI_RECORD_SIZE} bytes, got ${cdi.length}`);
  }
  const segments: CdiSegment[] = [];
  for (let i = 0; i < segmentCount; i++) {
    const r = cdi.subarray(i * CDI_RECORD_SIZE, (i + 1) * CDI_RECORD_SIZE);
    const what = `.CDI record ${i + 1}`;
    expectBytes(r, 268, [0, 0, 1, 0, 0, 0, 0, 0, 0, 0], `${what} trailer`);
    const name = trimField(r.subarray(0, 256));
    if (!/^[\x21-\x7e]+\.bin$/i.test(name)) throw new FirmwareFormatError(`${what} has no image name`);
    const address = u32le(r, 256);
    // Main-MCU images live in on-chip flash. Add-on boards (APRS/BT module,
    // Bluetooth mic) ship packages with other addresses and are flashed differently.
    if (r[259] !== 0x08) {
      throw new FirmwareFormatError(
        `${what} address 0x${address.toString(16)} is outside MCU flash (0x08xxxxxx); not a radio firmware`,
      );
    }
    segments.push({ name, address, size: u32le(r, 260), offset: u32le(r, 264) });
  }
  return segments;
}

/** Cross-checks the three files and returns a flashable image. */
export function parseFirmware(spi: Uint8Array, cdi: Uint8Array, cdd: Uint8Array): FirmwareImage {
  const s = parseSpi(spi);
  const records = parseCdi(cdi, s.segmentCount);
  const size = records.reduce((n, r) => n + r.size, 0);
  if (size !== s.imageSize) {
    throw new FirmwareFormatError(`Image size mismatch: .spi ${s.imageSize}, .CDI segments ${size}`);
  }
  let expectedOffset = 0;
  for (const r of records) {
    if (r.offset !== expectedOffset) {
      throw new FirmwareFormatError(`Segment ${r.name} starts at .CDD offset ${r.offset}, expected ${expectedOffset}`);
    }
    expectedOffset += r.size;
  }
  const byAddress = [...records].sort((a, b) => a.address - b.address);
  for (let i = 1; i < byAddress.length; i++) {
    if (byAddress[i]!.address < byAddress[i - 1]!.address + byAddress[i - 1]!.size) {
      throw new FirmwareFormatError("Firmware segments overlap");
    }
  }
  // Some vendor packages (e.g. D878UV V3.08N) carry a few junk bytes after the
  // image. The descriptors agree on the size, so only that much is flashed.
  if (cdd.length < size) {
    throw new FirmwareFormatError(`.CDD is ${cdd.length} bytes, descriptors say ${size}`);
  }
  return {
    model: s.model,
    hwVersion: s.hwVersion,
    segments: records.map((r) => ({ address: r.address, data: cdd.subarray(r.offset, r.offset + r.size) })),
    size,
    trailingBytes: cdd.length - size,
  };
}
