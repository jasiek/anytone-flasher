import type { CodeplugRegion } from "./dump";

// AT-D168UV codeplug memory map for the raw backup.
//
// Taken from qdmr (lib/d168uv_codeplug.*, which derives from lib/d878uv_codeplug.*
// and lib/d868uv_codeplug.*): every element qdmr reads in allocateBitmaps,
// allocateForDecoding and allocateUpdated, at maximum capacity. Compared with
// the D878UV map it adds fixed location names (0x02504800) and two unknown
// blocks at 0x025c2000 and 0x025c2c80 (D168UVCodeplug::allocateUpdated).
// Boot logo, standby pictures, GPS template and local info addresses are
// unknown for the D168UV and are left out. The callsign database
// (D878UV2CallsignDB: index 0x04000000-0x047c7d00, limits 0x04840000, entries
// from 0x05500000) is not included. Note that qdmr reads the contact ID map at
// the D868UV address 0x04340000, which falls inside that index range.

const BANK_STRIDE = 0x40000;

function banks(name: string, base: number, count: number, length: number, lastLength = length): CodeplugRegion[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${name} ${i}`,
    address: base + i * BANK_STRIDE,
    length: i === count - 1 ? lastLength : length,
  }));
}

export const D168UV_CODEPLUG: CodeplugRegion[] = [
  // 4000 channels, 128 per bank, 0x40 each, with the D878UV-style extension record at +0x2000.
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
  { name: "DMR APRS message", address: 0x02501100, length: 0x30 },
  { name: "analog APRS message", address: 0x02501200, length: 0x40 },
  { name: "settings ext", address: 0x02501400, length: 0x200 },
  { name: "analog APRS RX list", address: 0x02501800, length: 0x100 },
  { name: "fixed location names", address: 0x02504800, length: 0x90 },
  { name: "zone names", address: 0x02540000, length: 0x1f40 },
  { name: "radio IDs", address: 0x02580000, length: 0x1f40 },
  { name: "primary radio ID", address: 0x02582000, length: 0x20 },
  { name: "analog quick call", address: 0x025c0000, length: 0x100 },
  { name: "status messages", address: 0x025c0100, length: 0x400 },
  { name: "hot keys", address: 0x025c0500, length: 0x360 },
  { name: "status message bitmap", address: 0x025c0b00, length: 0x10 },
  { name: "RX group list bitmap", address: 0x025c0b10, length: 0x20 },
  { name: "ARC4 keys", address: 0x025c0c00, length: 0xff0 },
  { name: "ARC4 key bitmap", address: 0x025c1c00, length: 0x20 },
  { name: "unknown 0x025c2000", address: 0x025c2000, length: 0x20 },
  { name: "unknown 0x025c2c80", address: 0x025c2c80, length: 0x20 },
  // Up to 10000 talk groups / contacts: index, bitmap and 10 banks of 1000 × 0x64.
  { name: "contact index", address: 0x02600000, length: 0x9c40 },
  { name: "contact bitmap", address: 0x02640000, length: 0x500 },
  ...banks("contacts", 0x02680000, 10, 0x186a0),
  { name: "analog contact index", address: 0x02900000, length: 0x80 },
  { name: "analog contact bytemap", address: 0x02900100, length: 0x100 },
  { name: "analog contacts", address: 0x02940000, length: 0xc00 },
  { name: "RX group lists", address: 0x02980000, length: 0x1f320 },
  { name: "contact ID map", address: 0x04340000, length: 0x13890 },
];

