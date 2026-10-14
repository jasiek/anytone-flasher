// AnyTone firmware packages ship as three files sharing a base name:
//
//   .spi  51-byte descriptor: model, hardware version, image size
//   .CDI  278-byte descriptor: image name, flash start address, image size
//   .CDD  the raw image, streamed to the radio as-is
//
// Layout derived from reald/anytone-flash-tools (firmware/flash_firmware.py)
// and checked against the official D878UV V3.08N and V4.00 packages.

export const SPI_SIZE = 51;
/** D878UV V1.09 shipped a .spi without the final NUL byte. */
const SPI_SIZE_SHORT = 50;
export const CDI_SIZE = 278;

export interface SpiInfo {
  /** 6-character model tag, e.g. "D878UV". */
  model: string;
  /** 4-character hardware version, e.g. "V100". */
  hwVersion: string;
  /** Expected .CDD size in bytes. */
  imageSize: number;
}

export interface CdiInfo {
  model: string;
  imageSize: number;
  /** Flash address of the first image byte (STM32 flash, 0x08xxxxxx). */
  startAddress: number;
}

export interface FirmwareImage {
  model: string;
  hwVersion: string;
  startAddress: number;
  data: Uint8Array;
  /** Bytes past the declared size in the .CDD, which are ignored (see parseFirmware). */
  trailingBytes: number;
}

export class FirmwareFormatError extends Error {
  override name = "FirmwareFormatError";
}

const ascii = (b: Uint8Array) => String.fromCharCode(...b);

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
  expectBytes(spi, 0, [0x20, 0, 0, 0, 0x01, 0], ".spi header");
  expectBytes(spi, 10, [0, 0, 0, 0], ".spi padding");
  expectBytes(spi, 20, "  ", ".spi padding");
  expectBytes(spi, 32, " ".repeat(10), ".spi padding");
  expectBytes(spi, 46, spi.length === SPI_SIZE ? [0x20, 0x20, 0x20, 0x20, 0] : [0x20, 0x20, 0x20, 0x20], ".spi trailer");

  const model = ascii(spi.subarray(14, 20));
  const model2 = ascii(spi.subarray(26, 32));
  const hwVersion = ascii(spi.subarray(22, 26));
  const hwVersion2 = ascii(spi.subarray(42, 46));
  if (model !== model2) throw new FirmwareFormatError(`.spi model mismatch: ${model} / ${model2}`);
  if (hwVersion !== hwVersion2) {
    throw new FirmwareFormatError(`.spi hardware version mismatch: ${hwVersion} / ${hwVersion2}`);
  }
  return { model, hwVersion, imageSize: u32le(spi, 6) };
}

export function parseCdi(cdi: Uint8Array): CdiInfo {
  if (cdi.length !== CDI_SIZE) {
    throw new FirmwareFormatError(`.CDI must be ${CDI_SIZE} bytes, got ${cdi.length}`);
  }
  const model = ascii(cdi.subarray(0, 6));
  expectBytes(cdi, 6, "_1G.bin\0", ".CDI image name");
  expectBytes(cdi, 14, " ".repeat(242), ".CDI padding");
  expectBytes(cdi, 264, [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], ".CDI trailer");
  const startAddress = u32le(cdi, 256);
  if (cdi[259] !== 0x08) {
    throw new FirmwareFormatError(
      `.CDI start address 0x${startAddress.toString(16)} is outside STM32 flash (0x08xxxxxx)`,
    );
  }
  return { model, startAddress, imageSize: u32le(cdi, 260) };
}

/** Cross-checks the three files and returns a flashable image. */
export function parseFirmware(spi: Uint8Array, cdi: Uint8Array, cdd: Uint8Array): FirmwareImage {
  const s = parseSpi(spi);
  const c = parseCdi(cdi);
  if (s.model !== c.model) throw new FirmwareFormatError(`Model mismatch: .spi ${s.model}, .CDI ${c.model}`);
  if (s.imageSize !== c.imageSize) {
    throw new FirmwareFormatError(`Image size mismatch: .spi ${s.imageSize}, .CDI ${c.imageSize}`);
  }
  // Some vendor packages (e.g. D878UV V3.08N) carry a few junk bytes after the
  // image. Both descriptors agree on the size, so only that much is flashed.
  if (cdd.length < s.imageSize) {
    throw new FirmwareFormatError(`.CDD is ${cdd.length} bytes, descriptors say ${s.imageSize}`);
  }
  return {
    model: s.model,
    hwVersion: s.hwVersion,
    startAddress: c.startAddress,
    data: cdd.subarray(0, s.imageSize),
    trailingBytes: cdd.length - s.imageSize,
  };
}
