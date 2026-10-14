// AnyTone bootloader firmware-update protocol (D868UV/D878UV family).
//
// The radio must be powered on in update mode first (D878UV: hold PF3 + PTT).
//
//   > "UPDATE"                        < ACK
//   > 0x02                            < ident, e.g. "ID878UV\0" BF "V100" ... ACK
//   > 0x01 addr[4 LE] data[32] sum[2 LE] 0x06   < ACK    (repeated for the whole .CDD)
//   > 0x18                            < ACK
//
// `sum` is the 16-bit sum of the address and data bytes. The last block is
// zero-padded to 32 bytes. After the transfer the radio is restarted with
// PF1 + PTT to run the on-device installer.

import type { FirmwareImage } from "../firmware/format";
import type { Transport } from "../serial/transport";

export const ACK = 0x06;
export const CMD_WRITE = 0x01;
export const CMD_IDENT = 0x02;
export const CMD_END = 0x18;
export const ENTER_UPDATE = new TextEncoder().encode("UPDATE");
export const BLOCK_SIZE = 32;
export const PACKET_SIZE = 1 + 4 + BLOCK_SIZE + 2 + 1;

/** Builds one write packet. `block` may be shorter than BLOCK_SIZE (it is zero-padded). */
export function buildWritePacket(address: number, block: Uint8Array): Uint8Array {
  if (block.length > BLOCK_SIZE) throw new RangeError(`block exceeds ${BLOCK_SIZE} bytes`);
  const p = new Uint8Array(PACKET_SIZE);
  p[0] = CMD_WRITE;
  p[1] = address & 0xff;
  p[2] = (address >>> 8) & 0xff;
  p[3] = (address >>> 16) & 0xff;
  p[4] = (address >>> 24) & 0xff;
  p.set(block, 5);
  let sum = 0;
  for (let i = 1; i < 5 + BLOCK_SIZE; i++) sum += p[i]!;
  p[5 + BLOCK_SIZE] = sum & 0xff;
  p[6 + BLOCK_SIZE] = (sum >>> 8) & 0xff;
  p[7 + BLOCK_SIZE] = ACK;
  return p;
}

export interface DeviceIdent {
  /** Model tag as used in firmware descriptors, e.g. "D878UV". */
  model: string;
  hwVersion: string;
  /** Band/frequency-range code (see at-d878uv_protocol.md). */
  band: number;
  raw: Uint8Array;
}

/** Parses the reply to CMD_IDENT: "I" + model[6] + 0x00 + band + hw[4] + ... + ACK. */
export function parseIdent(raw: Uint8Array): DeviceIdent {
  if (raw.length < 13 || raw[raw.length - 1] !== ACK) {
    throw new FlashError(`Unexpected identification reply: ${hex(raw) || "(nothing)"}`);
  }
  const text = (a: number, b: number) => String.fromCharCode(...raw.subarray(a, b));
  return { model: text(1, 7), hwVersion: text(9, 13), band: raw[8]!, raw };
}

export class FlashError extends Error {
  override name = "FlashError";
}

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export type FlashPhase = "handshake" | "identify" | "transfer" | "finish" | "done";

export interface FlashProgress {
  phase: FlashPhase;
  bytesSent: number;
  totalBytes: number;
  retries: number;
}

export interface FlashOptions {
  onProgress?: (p: FlashProgress) => void;
  onLog?: (msg: string) => void;
  /** Called after identification; throw to reject the radio. */
  onIdent?: (ident: DeviceIdent) => void;
  signal?: AbortSignal;
  /** Attempts per packet before giving up (reference tool uses 3). */
  maxAttempts?: number;
  ackTimeoutMs?: number;
  handshakeTimeoutMs?: number;
}

export async function flashFirmware(
  t: Transport,
  image: FirmwareImage,
  opts: FlashOptions = {},
): Promise<DeviceIdent> {
  const {
    onProgress = () => {},
    onLog = () => {},
    onIdent,
    signal,
    maxAttempts = 3,
    ackTimeoutMs = 1000,
    handshakeTimeoutMs = 2000,
  } = opts;
  const total = image.data.length;
  let sent = 0;
  let retries = 0;
  const progress = (phase: FlashPhase) => onProgress({ phase, bytesSent: sent, totalBytes: total, retries });
  const checkAbort = () => {
    if (signal?.aborted) throw new FlashError("Aborted by user");
  };

  // 1. Enter update session.
  progress("handshake");
  onLog('Sending "UPDATE"…');
  t.flushInput();
  await t.write(ENTER_UPDATE);
  const hello = await t.read(handshakeTimeoutMs, 50);
  if (hello.length !== 1 || hello[0] !== ACK) {
    throw new FlashError(
      hello.length === 0
        ? "No answer from radio. Is it switched on in firmware-update mode and is the right port selected?"
        : `Unexpected answer to UPDATE: ${hex(hello)}`,
    );
  }
  checkAbort();

  // 2. Identify and verify the radio matches the image.
  progress("identify");
  await t.write(Uint8Array.of(CMD_IDENT));
  const ident = parseIdent(await t.read(handshakeTimeoutMs, 50));
  onLog(`Radio reports model ${ident.model}, hardware ${ident.hwVersion} (${hex(ident.raw)})`);
  if (ident.model !== image.model) {
    throw new FlashError(`Radio is a ${ident.model}, firmware is for ${image.model}`);
  }
  if (ident.hwVersion !== image.hwVersion) {
    throw new FlashError(`Radio hardware ${ident.hwVersion} does not match firmware hardware ${image.hwVersion}`);
  }
  onIdent?.(ident);
  checkAbort();

  // 3. Stream the image.
  onLog(`Writing ${total} bytes from 0x${image.startAddress.toString(16)}…`);
  progress("transfer");
  let lastReport = 0;
  for (let off = 0; off < total; off += BLOCK_SIZE) {
    checkAbort();
    const packet = buildWritePacket(image.startAddress + off, image.data.subarray(off, off + BLOCK_SIZE));
    for (let attempt = 1; ; attempt++) {
      await t.write(packet);
      const resp = await t.read(ackTimeoutMs);
      if (resp.length === 1 && resp[0] === ACK) break;
      if (attempt >= maxAttempts) {
        throw new FlashError(
          `Block at 0x${(image.startAddress + off).toString(16)} failed after ${attempt} attempts ` +
            `(last reply: ${hex(resp) || "timeout"})`,
        );
      }
      retries++;
      onLog(`Block 0x${(image.startAddress + off).toString(16)}: ${hex(resp) || "timeout"}, retrying`);
      // Let a late ACK land before discarding it so it isn't taken as the retry's ACK.
      await t.read(50, 50);
      t.flushInput();
    }
    sent = Math.min(off + BLOCK_SIZE, total);
    const now = Date.now();
    if (now - lastReport > 50 || sent === total) {
      lastReport = now;
      progress("transfer");
    }
  }

  // 4. Close the transfer.
  progress("finish");
  onLog("Closing transfer…");
  await t.write(Uint8Array.of(CMD_END));
  const bye = await t.read(handshakeTimeoutMs, 50);
  if (bye.length !== 1 || bye[0] !== ACK) {
    throw new FlashError(`Radio did not confirm end of transfer (${hex(bye) || "timeout"})`);
  }
  progress("done");
  onLog("Transfer complete.");
  return ident;
}
