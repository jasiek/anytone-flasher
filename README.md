# AnyTone Flasher

Static web app that flashes official AnyTone firmware over USB with the
[Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API).
You pick a radio model, a bundled firmware and a serial port, and the page shows transfer progress.
It needs desktop Chrome, Edge or Opera, served over HTTPS or from `localhost`.

Supported radios and bundled firmware (every official release BridgeCom publishes, about 72 MB):

| Radio | Versions | Notes |
|---|---|---|
| AT-D878UV / UV Plus | V1.09 – V4.00 (26) | |
| AT-D878UVII / UVII Plus | V2.01B – V4.00 (14) | Reports `D878UV2`; D878UV firmware is refused |
| AT-D578UV / UV Pro | V1.05 – V1.21 (15) | GD32 and AT32 builds from V1.17 |
| AT-D578UV Plus / UVII | V2.01 – V2.08 (8) | GD32 and AT32 builds from V2.03 |
| AT-D168UV | V1.03 – V1.07 (5) | Two-segment images |

The D578UV comes with either a GigaDevice GD32 or an Artery AT32 processor, and each needs its own
build. The app picks the build from the USB vendor ID of the radio's serial port (0x28e9 = GD32,
0x2e3c = AT32, as qdmr does). It refuses to flash if the ID is unknown or the chosen release has no
build for that processor.

Not bundled:
- D168UV V1.02: its `.spi` gives two different hardware versions (V100 and V102).
- Firmware for the APRS/BT board and the BT01 Bluetooth mic, which ships in the same packages.
  It is not radio firmware: it loads outside MCU flash, and the parser rejects it.
- D868UV: no official download source found.

> Flashing erases the codeplug. Back it up with the CPS first.

## Use

1. Select model and firmware.
2. With **Save a codeplug backup** ticked (default), switch the radio on normally and pick its port.
   Without a backup, start it in update mode instead. The page shows how for each model;
   on the D878UV you hold **PF3 + PTT** while switching on.
3. Tick the confirmation box, press **Flash firmware**.
   - If backing up, the codeplug is read and downloaded as a `.atdump` file.
     You are then asked to restart the radio in update mode and press Continue.
4. When the transfer finishes, follow the shown steps to run the on-radio installer
   (D878UV: hold **PF1 + PTT** while switching on).

**Back up codeplug only** saves the backup without flashing.

## Codeplug backup

The backup is a raw read of the radio's codeplug memory, not a CPS `.rdt` file. It is meant for
restoring with a tool that writes raw memory, or for decoding later. It covers about 2.1–2.2 MB
per radio: channels, zones, scan lists, talk groups/contacts (up to 10000), RX group lists, radio IDs,
SMS, roaming, encryption keys, settings and APRS. The D878UV maps add the boot logo and standby
pictures, and the D578UV map adds air-band channels. The maps come from qdmr
(`src/codeplug/d878uv.ts`, `d578uv.ts`, `d168uv.ts`). The callsign database is not included.

Reading uses the programming-mode protocol (`src/protocol/program.ts`):
`PROGRAM` → `QX 06`, `02` → ident, `R addr[4 BE] 10` → `W addr[4 BE] 10 data[16] sum 06`, `END` → `06`.

File layout (`src/codeplug/dump.ts`): `"ATCPDUMP"`, u32 LE format version (1), u32 LE header length,
JSON header (model, hardware, ident, and each region's name, address, length and offset), then the
region data concatenated.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # parser, packet and flasher tests (mock radio)
npm run build      # static site in dist/
```

## Protocol

The protocol comes from [reald/anytone-flash-tools](https://github.com/reald/anytone-flash-tools)
(`firmware/flash_firmware.py`, `at-d878uv_protocol.md`). See `src/protocol/anytone.ts`:

| Host → radio | Radio → host |
|---|---|
| `UPDATE` | `06` |
| `02` | `"I" model[6] 00 band hw[4] … 06` |
| `01 addr[4 LE] data[32] sum[2 LE] 06` (repeated) | `06` |
| `18` | `06` |

`sum` is the 16-bit sum of the address and data bytes. The final block is zero-padded.
Before writing anything, the flasher checks the radio's model and hardware version against the firmware.

A firmware package has three files (`src/firmware/format.ts`):
- `.spi`: segment count, size, an 8-byte model tag such as `D878UV2` or `578UV2A`, and the hardware version.
- `.CDI`: one 278-byte record per segment, giving name, address, size and offset.
- `.CDD`: the image.

The reference Python tool compares only 6 characters of the model and rejects 7-character tags.
Several packages have up to a few hundred leftover bytes after the declared image size; these are ignored. V1.09's `.spi` also lacks its final NUL byte, which the parser accepts.

## Adding firmware or models

```sh
npm run add-firmware -- d878uv "path/to/D878UV_V4.00_20250725.spi"
# if the file name has no usable version/date:
npm run add-firmware -- d878uv path/to/fw.spi --version 1.16 --date 2019-11-22
```

This validates the package, copies it to `public/firmware/<model>/<version>/` and records it in
`public/firmware/manifest.json`, including a SHA-256 hash that the app verifies before flashing.
To add another model of the same family, add an entry to `src/models.ts` with its ident model,
firmware tags (and the MCU of each), hardware versions and key sequences. Then bundle its firmware
the same way. Each build of a two-MCU release is added separately, and its MCU comes from the tag.
