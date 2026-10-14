// Radios that speak the AnyTone bootloader protocol (src/protocol/anytone.ts).
// To add one: add an entry here, then bundle firmware with `npm run add-firmware`.
// `firmwareModel` and `hwVersions` must match what the radio reports to the
// ident command and what its .spi descriptors contain.

export interface RadioModel {
  id: string;
  name: string;
  /** 6-character model tag in .spi/.CDI and the radio's ident reply. */
  firmwareModel: string;
  hwVersions: string[];
  /** Keys held while powering on to enter firmware-receive mode. */
  updateModeKeys: string;
  /** Keys held while powering on afterwards to run the on-radio installer. */
  installKeys: string;
  notes?: string;
}

export const MODELS: RadioModel[] = [
  {
    id: "d878uv",
    name: "AnyTone AT-D878UV / UV Plus",
    firmwareModel: "D878UV",
    hwVersions: ["V100"],
    updateModeKeys: "PF3 (blue key on top) + PTT",
    installKeys: "PF1 (side key next to PTT) + PTT",
    notes: "Original D878UV (V1). The D878UVII / UVII Plus uses a different firmware line and is not supported yet.",
  },
];
