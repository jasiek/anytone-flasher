import { describe, expect, it } from "vitest";
import { groupReleases, selectBuild, type FirmwareEntry } from "../src/firmware/catalog";
import { MCU_USB_VENDOR } from "../src/models";

const entry = (version: string, mcu: FirmwareEntry["mcu"], firmwareModel: string): FirmwareEntry => ({
  modelId: "d578uv",
  version,
  date: null,
  firmwareModel,
  mcu,
  hwVersion: "V100",
  segments: [],
  size: 0,
  sha256: "",
  files: { spi: "", cdi: "", cdd: "" },
});

const [v121, v116] = groupReleases([
  entry("1.21", "at32", "D578UVA"),
  entry("1.21", "gd32", "D578UV"),
  entry("1.16", "gd32", "D578UV"),
]);

describe("selectBuild", () => {
  it("picks the build for the radio's MCU from the USB vendor ID", () => {
    expect(selectBuild(v121!, MCU_USB_VENDOR.at32).firmwareModel).toBe("D578UVA");
    expect(selectBuild(v121!, MCU_USB_VENDOR.gd32).firmwareModel).toBe("D578UV");
  });

  it("refuses when the MCU has no build in that release", () => {
    expect(() => selectBuild(v116!, MCU_USB_VENDOR.at32)).toThrow(/AT32 processor and V1.16 has no AT32 build/);
  });

  it("refuses when the MCU can't be identified", () => {
    expect(() => selectBuild(v121!, undefined)).toThrow(/Can't tell which processor/);
    expect(() => selectBuild(v121!, 0x1234)).toThrow(/USB vendor 1234/);
  });

  it("uses the only build of single-MCU radios regardless of the port", () => {
    const [r] = groupReleases([{ ...entry("4.00", null, "D878UV"), modelId: "d878uv" }]);
    expect(selectBuild(r!, undefined).firmwareModel).toBe("D878UV");
  });
});
