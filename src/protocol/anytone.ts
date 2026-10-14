// AnyTone bootloader firmware-update protocol (D878UV, D878UVII, D578UV, D168UV, …).
//
// The radio must be powered on in update mode first (D878UV: hold PF3 + PTT).
//
//   > "UPDATE"                        < ACK
//   > 0x02                            < ident, e.g. "ID878UV\0" BF "V100" ... ACK
//   > 0x01 addr[4 LE] data[32] sum[2 LE] 0x06   < ACK    (repeated for each image segment)
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

/**
 * Parses the reply to CMD_IDENT: "I" + model[7, NUL-padded] + band + hw[4] + ... + ACK,
 * e.g. "ID878UV\0" or "ID878UV2" followed by the band byte. The model must be
 * compared in full: "D878UV2" (UVII) must not match "D878UV".
 */
export function parseIdent(raw: Uint8Array): DeviceIdent {
  if (raw.length < 13 || raw[0] !== 0x49 || raw[raw.length - 1] !== ACK) {
    throw new FlashError(`Unexpected identification reply: ${hex(raw) || "(nothing)"}`);
  }
  const text = (a: number, b: number) =>
    String.fromCharCode(...raw.subarray(a, b)).replace(/\0[\s\S]*$/, "").trimEnd();
  return { model: text(1, 8), hwVersion: text(9, 13), band: raw[8]!, raw };
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
  /**
   * Model the radio must report. Defaults to the firmware's model tag; differs
   * for MCU-variant builds (e.g. firmware "D578UVA" for a radio reporting "D578UV").
   */
  identModel?: string;
  /** Called after identification; throw to reject the radio. */
  onIdent?: (ident: DeviceIdent) => void;
  signal?: AbortSignal;
  /** Attempts per packet before giving up. */
  maxAttempts?: number;
  /** Wait for a block's first ACK; resends wait `retryTimeoutMs`. */
  ackTimeoutMs?: number;
  retryTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  /** Upper bound for the gap inserted between packets after lost packets. */
  maxPacketGapMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export async function flashFirmware(
  t: Transport,
  image: FirmwareImage,
  opts: FlashOptions = {},
): Promise<DeviceIdent> {
  const {
    onProgress = () => {},
    onLog = () => {},
    onIdent,
    identModel = image.model,
    signal,
    maxAttempts = 5,
    ackTimeoutMs = 400,
    retryTimeoutMs = 1500,
    handshakeTimeoutMs = 2000,
    maxPacketGapMs = 20,
  } = opts;
  const total = image.size;
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
  if (ident.model !== identModel) {
    throw new FlashError(`Radio is a ${ident.model}, firmware is for ${identModel}`);
  }
  if (ident.hwVersion !== image.hwVersion) {
    throw new FlashError(`Radio hardware ${ident.hwVersion} does not match firmware hardware ${image.hwVersion}`);
  }
  onIdent?.(ident);
  checkAbort();

  // 3. Stream the image, segment by segment.
  //
  // Sent back to back, some radios drop an occasional packet (seen on a
  // D878UV over macOS: every ~5th block unanswered, the resend accepted). So
  // after a lost packet a gap is inserted before each packet, doubling up to
  // maxPacketGapMs, and halved again after a long clean run.
  progress("transfer");
  let lastReport = 0;
  let gapMs = 0;
  let clean = 0;
  let ackCount = 0;
  let ackTotalMs = 0;
  let ackMaxMs = 0;
  const ackStats = () =>
    ackCount ? `ACK avg ${(ackTotalMs / ackCount).toFixed(1)} ms, max ${ackMaxMs.toFixed(0)} ms` : "no ACKs yet";
  for (const seg of image.segments) {
    onLog(`Writing ${seg.data.length} bytes at 0x${seg.address.toString(16)}…`);
    for (let off = 0; off < seg.data.length; off += BLOCK_SIZE) {
      checkAbort();
      const address = seg.address + off;
      const packet = buildWritePacket(address, seg.data.subarray(off, off + BLOCK_SIZE));
      for (let attempt = 1; ; attempt++) {
        if (gapMs) await sleep(gapMs);
        const t0 = now();
        await t.write(packet);
        let resp = await t.read(attempt === 1 ? ackTimeoutMs : retryTimeoutMs);
        if (resp.length === 0) {
          // Give a slow ACK a moment more; one that arrives now still confirms this block.
          resp = await t.read(100, 20);
          if (resp.length === 1 && resp[0] === ACK) onLog(`Block 0x${address.toString(16)}: late ACK after ${(now() - t0).toFixed(0)} ms`);
        }
        if (resp.length === 1 && resp[0] === ACK) {
          const ms = now() - t0;
          ackCount++;
          ackTotalMs += ms;
          ackMaxMs = Math.max(ackMaxMs, ms);
          break;
        }
        if (attempt >= maxAttempts) {
          throw new FlashError(
            `Block at 0x${address.toString(16)} failed after ${attempt} attempts ` +
              `(last reply: ${hex(resp) || "timeout"}; ${ackStats()})`,
          );
        }
        retries++;
        clean = 0;
        const prevGap = gapMs;
        if (resp.length === 0) gapMs = Math.min(maxPacketGapMs, Math.max(1, gapMs * 2));
        onLog(
          `Block 0x${address.toString(16)}: ${hex(resp) || "timeout"}, retrying` +
            (gapMs !== prevGap ? ` (now ${gapMs} ms between packets; ${ackStats()})` : ""),
        );
        await t.read(50, 50);
        t.flushInput();
      }
      if (gapMs && ++clean >= 2000) {
        gapMs = Math.floor(gapMs / 2);
        clean = 0;
        onLog(`No lost packets for a while, now ${gapMs} ms between packets`);
      }
      sent += Math.min(BLOCK_SIZE, seg.data.length - off);
      const t1 = Date.now();
      if (t1 - lastReport > 50 || sent === total) {
        lastReport = t1;
        progress("transfer");
      }
    }
  }
  onLog(`Sent ${total} bytes with ${retries} resends (${ackStats()})`);

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
