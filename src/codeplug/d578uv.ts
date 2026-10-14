import type { CodeplugRegion } from "./dump";

// AT-D578UV codeplug memory map for the raw backup. qdmr has no separate
// D578UVII codeplug: RadioInfo::D578UVII is an alias of D578UV
// (lib/radioinfo.hh:40, lib/d578uv.cc:159), so D578UV2_CODEPLUG is the same list.
//
// Taken from qdmr (lib/d578uv_codeplug.*, on top of lib/d878uv_codeplug.* and
// lib/d868uv_codeplug.*): every element qdmr reads in allocateBitmaps,
// allocateForDecoding and allocateUpdated, at maximum capacity rather than only
// the used slots. Differences from the D878UV map:
//   - hot keys are 0x970 bytes (24 entries), and D578UVCodeplug::allocateHotKeySettings
//     no longer reads the analog quick-call or status-message blocks;
//   - general settings no longer read the DMR APRS message at 0x02501100 or the
//     primary radio ID at 0x02582000; the DMR APRS message is read at 0x02501280;
//   - air-band (AM receive) channels, VFO and bitmaps at 0x02bc0000;
//   - contact ID map moved to 0x04800000.
// Local info (0x02fa0000/0x100) is not read by qdmr but is read by the D578UV
// CPS (doc/reveng/anytone/d578uv/at_d578uv_emulator.py). Boot logo and standby
// picture addresses are unknown for the D578UV and are left out. The callsign
// database (D878UV2CallsignDB: index 0x04000000-0x047c7d00, limits 0x04840000,
// entries from 0x05500000) is not included: it is re-downloadable.

const BANK_STRIDE = 0x40000;

function banks(name: string, base: number, count: number, length: number, lastLength = length): CodeplugRegion[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${name} ${i}`,
    address: base + i * BANK_STRIDE,
    length: i === count - 1 ? lastLength : length,
  }));
}

export const D578UV_CODEPLUG: CodeplugRegion[] = [
  // 4000 channels, 128 per bank, 0x40 each, with the extension record (D578UV ChannelExtensionElement) at +0x2000.
  ...banks("channels", 0x00800000, 31, 0x4000),
  { name: "channels 31 + VFO A/B", address: 0x00fc0000, length: 0x880 },
  { name: "channel ext 31 + VFO ext", address: 0x00fc2000, length: 0x880 },
  { name: "zone channels", address: 0x01000000, length: 0x1f400 },
  { name: "roaming channels", address: 0x01040000, length: 0x1f40 },
  { name: "roaming channel bitmap", address: 0x01042000, length: 0x20 },
  { name: "roaming zone bitmap", address: 0x01042080, length: 0x10 },
  { name: "roaming zones", address: 0x01043000, length: 0x2000 },
  // 250 scan lists, 16 per bank at 0x200 stride, 0x90 each.
  ...banks("scan lists", 0x01080000, 16, 0x1e90, 0x1290),
  { name: "SMS index", address: 0x01640000, length: 0x640 },
  { name: "SMS bytemap", address: 0x01640800, length: 0x90 },
  ...banks("SMS", 0x02140000, 13, 0x800),
  { name: "FM channels", address: 0x02480000, length: 0x200 },
  { name: "FM VFO", address: 0x02480200, length: 0x10 },
  { name: "FM channel bitmap", address: 0x02480210, length: 0x20 },
  { name: "5-tone IDs", address: 0x024c0000, length: 0xc80 },
  { name: "5-tone ID bitmap", address: 0x024c0c80, length: 0x10 },
  { name: "5-tone functions", address: 0x024c0d00, length: 0x200 },
  { name: "5-tone settings", address: 0x024c1000, length: 0x80 },
  { name: "DTMF settings", address: 0x024c1080, length: 0x50 },
  { name: "2-tone IDs", address: 0x024c1100, length: 0x180 },
  { name: "2-tone ID bitmap", address: 0x024c1280, length: 0x10 },
  { name: "2-tone settings", address: 0x024c1290, length: 0x10 },
  { name: "zone bitmap", address: 0x024c1300, length: 0x20 },
  { name: "radio ID bitmap", address: 0x024c1320, length: 0x20 },
  { name: "scan list bitmap", address: 0x024c1340, length: 0x20 },
  { name: "hidden zone bitmap", address: 0x024c1360, length: 0x20 },
  { name: "alarm settings", address: 0x024c1400, length: 0x20 },
  { name: "alarm settings ext", address: 0x024c1440, length: 0x30 },
  { name: "channel bitmap", address: 0x024c1500, length: 0x200 },
  { name: "DMR encryption keys", address: 0x024c1700, length: 0x40 },
  { name: "enhanced encryption keys", address: 0x024c1800, length: 0x500 },
  { name: "repeater offsets", address: 0x024c2000, length: 0x3f0 },
  { name: "2-tone functions", address: 0x024c2400, length: 0x200 },
  { name: "2-tone function bitmap", address: 0x024c2600, length: 0x10 },
  { name: "AES keys", address: 0x024c4000, length: 0x3fc0 },
  { name: "AES key bitmap", address: 0x024c8000, length: 0x20 },
  { name: "general settings", address: 0x02500000, length: 0xf0 },
  { name: "zone A/B channel", address: 0x02500100, length: 0x400 },
  { name: "DTMF ID list", address: 0x02500500, length: 0x100 },
  { name: "boot settings", address: 0x02500600, length: 0x30 },
  { name: "APRS settings", address: 0x02501000, length: 0x100 },
  // Read by qdmr on the D878UV but not the D578UV; kept so the backup errs on the side of too much.
  { name: "DMR APRS message (D878 address)", address: 0x02501100, length: 0x30 },
  { name: "analog APRS message", address: 0x02501200, length: 0x40 },
  { name: "DMR APRS message", address: 0x02501280, length: 0x30 },
  { name: "settings ext", address: 0x02501400, length: 0x200 },
  { name: "analog APRS RX list", address: 0x02501800, length: 0x100 },
  { name: "zone names", address: 0x02540000, length: 0x1f40 },
  { name: "radio IDs", address: 0x02580000, length: 0x1f40 },
  { name: "primary radio ID (D878 address)", address: 0x02582000, length: 0x20 },
  // Hot keys: 0x970 bytes from 0x025c0500 (to 0x025c0e70). The block overlaps the
  // status message / RX group list bitmaps and the start of the ARC4 key area, so it
  // is split around them; the tail 0x025c0c00-0x025c0e70 is covered by "ARC4 keys".
  // Skipped by qdmr's D578UV hot key override; kept for a complete backup.
  { name: "analog quick call", address: 0x025c0000, length: 0x100 },
  { name: "status messages", address: 0x025c0100, length: 0x400 },
  { name: "hot keys", address: 0x025c0500, length: 0x600 },
  { name: "status message bitmap", address: 0x025c0b00, length: 0x10 },
  { name: "RX group list bitmap", address: 0x025c0b10, length: 0x20 },
  { name: "hot keys (cont.)", address: 0x025c0b30, length: 0xd0 },
  { name: "ARC4 keys", address: 0x025c0c00, length: 0xff0 },
  { name: "ARC4 key bitmap", address: 0x025c1c00, length: 0x20 },
  // Up to 10000 talk groups / contacts: index, bitmap and 10 banks of 1000 × 0x64.
  // (D578UVCodeplug::allocateContacts steps 0x190 per contact rather than per block of
  // four, so at full capacity qdmr over-reads past each bank; the encoder uses 0x64.)
  { name: "contact index", address: 0x02600000, length: 0x9c40 },
  { name: "contact bitmap", address: 0x02640000, length: 0x500 },
  ...banks("contacts", 0x02680000, 10, 0x186a0),
  { name: "analog contact index", address: 0x02900000, length: 0x80 },
  { name: "analog contact bytemap", address: 0x02900100, length: 0x100 },
  { name: "analog contacts", address: 0x02940000, length: 0xc00 },
  { name: "RX group lists", address: 0x02980000, length: 0x1f320 },
  // 100 air-band channels, 0x20 each.
  { name: "air band channels", address: 0x02bc0000, length: 0xc80 },
  { name: "air band VFO", address: 0x02bc1000, length: 0x20 },
  { name: "air band channel bitmap", address: 0x02bc1020, length: 0x20 },
  { name: "air band scan bitmap", address: 0x02bc1040, length: 0x20 },
  { name: "local info", address: 0x02fa0000, length: 0x100 },
  { name: "contact ID map", address: 0x04800000, length: 0x13890 },
];

// AT-D578UVII: qdmr uses the D578UV codeplug unchanged.
export const D578UV2_CODEPLUG: CodeplugRegion[] = D578UV_CODEPLUG;
