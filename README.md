# AnyTone Flasher

Static web app that flashes official AnyTone firmware over USB with the
[Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API).
You pick a radio model, a bundled firmware and a serial port, and the page shows transfer progress.
It needs desktop Chrome, Edge or Opera, served over HTTPS or from `localhost`.

Supported: **AnyTone AT-D878UV / UV Plus (V1, hardware V100)**. Bundled firmware: every official
release BridgeCom publishes for it, V1.09 through V4.00 (26 versions, about 22 MB).

> Flashing erases the codeplug. Back it up with the CPS first.

## Use

1. Select model and firmware.
2. With **Save a codeplug backup** ticked (default), switch the radio on normally and pick its port.
   Without a backup, switch it on in update mode instead: hold **PF3 + PTT** while switching on.
3. Tick the confirmation box, press **Flash firmware**.
   - If backing up, the codeplug is read and downloaded as a `.atdump` file.
     You are then asked to restart the radio in update mode (**PF3 + PTT**) and press Continue.
4. When the transfer finishes, switch the radio off and hold **PF1 + PTT** while switching it on.
   This starts the on-radio installer.

**Back up codeplug only** saves the backup without flashing.

## Codeplug backup

The backup is a raw read of the radio's codeplug memory, not a CPS `.rdt` file. It is meant for
restoring with a tool that writes raw memory, or for decoding later. For the D878UV it covers
2.2 MB in 135 regions: channels, zones, scan lists, talk groups/contacts (up to 10000), RX group
lists, radio IDs, SMS, roaming, encryption keys, settings, APRS, boot logo and standby pictures.
The map comes from qdmr (`src/codeplug/d878uv.ts`). The callsign database is not included.

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
`.spi` (model, hardware version, size), `.CDI` (start address, size) and `.CDD` (image).
Four D878UV packages (V1.09, V1.16, V1.27, V3.08N) have 4–172 leftover bytes after the declared image size.
These are ignored. V1.09's `.spi` also lacks its final NUL byte, which the parser accepts.

## Adding firmware or models

```sh
npm run add-firmware -- d878uv "path/to/D878UV_V4.00_20250725.spi"
# if the file name has no usable version/date:
npm run add-firmware -- d878uv path/to/fw.spi --version 1.16 --date 2019-11-22
```

This validates the package, copies it to `public/firmware/<model>/<version>/` and records it in
`public/firmware/manifest.json`, including a SHA-256 hash that the app verifies before flashing.
To add another model of the same family (e.g. D868UV, D578UV), add an entry to `src/models.ts`
with the model tag and hardware versions the radio reports. Then bundle its firmware the same way.
