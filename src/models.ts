import type { CodeplugRegion } from "./codeplug/dump";
import { D168UV_CODEPLUG } from "./codeplug/d168uv";
import { D578UV_CODEPLUG, D578UV2_CODEPLUG } from "./codeplug/d578uv";
import { D878UV_CODEPLUG, D878UV2_CODEPLUG } from "./codeplug/d878uv";

// Radios that speak the AnyTone bootloader protocol (src/protocol/anytone.ts).
// To add one: add an entry here, then bundle firmware with `npm run add-firmware`.

/**
 * Some radios exist with two MCUs (GigaDevice GD32 or Artery AT32), which need
 * different firmware builds. The USB vendor ID of the radio's serial port tells
 * them apart (as in qdmr's AnytoneGD32Interface / AnytoneSTM32Interface).
 */
export type Mcu = "gd32" | "at32";

export const MCU_USB_VENDOR: Record<Mcu, number> = { gd32: 0x28e9, at32: 0x2e3c };

export const MCU_LABEL: Record<Mcu, string> = { gd32: "GD32", at32: "AT32" };

export function mcuFromUsbVendor(vid: number | undefined): Mcu | null {
  for (const [mcu, v] of Object.entries(MCU_USB_VENDOR)) if (v === vid) return mcu as Mcu;
  return null;
}

export interface RadioModel {
  id: string;
  name: string;
  /** Model the radio reports to the ident command (in both modes). */
  identModel: string;
  /**
   * Firmware model tags (.spi) accepted for this radio, and which MCU each
   * build is for (null: the radio has one MCU, any port is fine).
   */
  firmwareTags: Record<string, Mcu | null>;
  hwVersions: string[];
  /** How to start the radio in firmware-receive mode (one sentence). */
  updateMode: string;
  /** How to run the on-radio installer after the transfer (one sentence). */
  install: string;
  notes?: string;
  /** Memory regions saved by the codeplug backup; omit to disable backup. */
  codeplug?: CodeplugRegion[];
}

const D878_UPDATE_MODE = "Switch the radio off, then hold PF3 (blue key on top) + PTT while switching it on.";
const D878_INSTALL =
  "Switch the radio off, then hold PF1 (side key next to PTT) + PTT while switching it on and confirm the reset on the radio.";
const D578_UPDATE_MODE =
  "With the radio on, hold MENU + EXIT and switch it off with the power key. Keep holding until the screen is off " +
  "and the red LED blinks, then release.";
const D578_INSTALL =
  "Switch the radio off, then hold P2 + the channel knob while switching it on and confirm the reset with MENU.";

export const MODELS: RadioModel[] = [
  {
    id: "d878uv",
    name: "AnyTone AT-D878UV / UV Plus",
    identModel: "D878UV",
    firmwareTags: { D878UV: null },
    hwVersions: ["V100"],
    updateMode: D878_UPDATE_MODE,
    install: D878_INSTALL,
    codeplug: D878UV_CODEPLUG,
    notes: "The original D878UV (V1). Device Info on the radio shows the model as D878UV.",
  },
  {
    id: "d878uv2",
    name: "AnyTone AT-D878UVII / UVII Plus",
    identModel: "D878UV2",
    firmwareTags: { D878UV2: null },
    hwVersions: ["V100"],
    updateMode: D878_UPDATE_MODE,
    install: D878_INSTALL,
    codeplug: D878UV2_CODEPLUG,
    notes: "Device Info on the radio shows the model as D878UVII. Do not use D878UV firmware.",
  },
  {
    id: "d578uv",
    name: "AnyTone AT-D578UV / UV Pro (mobile)",
    identModel: "D578UV",
    // Before V1.16 only a GD32 build was published; AT32 radios appeared in 2022.
    firmwareTags: { D578UV: "gd32", D578UVA: "at32" },
    hwVersions: ["V100"],
    updateMode: D578_UPDATE_MODE,
    install: D578_INSTALL,
    codeplug: D578UV_CODEPLUG,
    notes:
      "Comes with a GD32 or AT32 processor, which need different builds. The right one is chosen automatically " +
      "from the radio's USB ID.",
  },
  {
    id: "d578uv2",
    name: "AnyTone AT-D578UV Plus / UVII (mobile)",
    identModel: "D578UV2",
    firmwareTags: { D578UV2: "gd32", "578UV2A": "at32" },
    hwVersions: ["V100"],
    updateMode: D578_UPDATE_MODE,
    install: D578_INSTALL,
    codeplug: D578UV2_CODEPLUG,
    notes:
      "Comes with a GD32 or AT32 processor, which need different builds. The right one is chosen automatically " +
      "from the radio's USB ID.",
  },
  {
    id: "d168uv",
    name: "AnyTone AT-D168UV",
    identModel: "D168UV",
    firmwareTags: { D168UV: null },
    hwVersions: ["V100"],
    updateMode: "Switch the radio off, then hold PF1 + PF2 (the two keys below PTT) while switching it on. The red LED blinks.",
    install: "Switch the radio off, then hold PTT + PF1 while switching it on and confirm with the green menu key.",
    codeplug: D168UV_CODEPLUG,
  },
];
