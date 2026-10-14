// AnyTone programming-mode protocol (radio switched on normally), used to
// back up the codeplug before flashing. From reald/anytone-flash-tools
// (at-d878uv_protocol.md) and qdmr (lib/anytone_interface.cc).
//
//   > "PROGRAM"                       < "QX" ACK
//   > 0x02                            < ident ... ACK
//   > "R" addr[4 BE] len              < "W" addr[4 BE] len data[len] sum ACK
//   > "END"                           < ACK
//
// `sum` is the 8-bit sum of address, length and data.

import type { Transport } from "../serial/transport";
import { ACK, CMD_IDENT, FlashError, hex, parseIdent, type DeviceIdent } from "./anytone";

const enc = new TextEncoder();
export const ENTER_PROGRAM = enc.encode("PROGRAM");
export const LEAVE_PROGRAM = enc.encode("END");
export const CMD_READ = 0x52; // "R"
export const RESP_WRITE = 0x57; // "W"
/** Bytes per read request. The radio accepts up to 255; qdmr and the CPS use 16. */
export const READ_BLOCK = 16;

export function buildReadRequest(address: number, length: number): Uint8Array {
  return Uint8Array.of(
    CMD_READ,
    (address >>> 24) & 0xff,
    (address >>> 16) & 0xff,
    (address >>> 8) & 0xff,
    address & 0xff,
    length,
  );
}

/** Validates a read reply and returns its payload. */
export function parseReadReply(reply: Uint8Array, address: number, length: number): Uint8Array {
  const expected = 1 + 4 + 1 + length + 2;
  if (reply.length !== expected || reply[0] !== RESP_WRITE || reply[expected - 1] !== ACK) {
    throw new FlashError(`Bad read reply for 0x${address.toString(16)}: ${hex(reply.subarray(0, 12)) || "timeout"}`);
  }
  const replyAddr = ((reply[1]! << 24) | (reply[2]! << 16) | (reply[3]! << 8) | reply[4]!) >>> 0;
  if (replyAddr !== address || reply[5] !== length) {
    throw new FlashError(`Read reply for 0x${replyAddr.toString(16)}, expected 0x${address.toString(16)}`);
  }
  let sum = 0;
  for (let i = 1; i < 6 + length; i++) sum += reply[i]!;
  if ((sum & 0xff) !== reply[6 + length]) {
    throw new FlashError(`Checksum error reading 0x${address.toString(16)}`);
  }
  return reply.slice(6, 6 + length);
}

export class ProgramSession {
  private constructor(
    private t: Transport,
    readonly ident: DeviceIdent,
  ) {}

  static async open(t: Transport, timeoutMs = 2000): Promise<ProgramSession> {
    t.flushInput();
    await t.write(ENTER_PROGRAM);
    const hello = await t.read(timeoutMs, 50);
    if (hello.length < 1 || hello[hello.length - 1] !== ACK) {
      throw new FlashError(
        hello.length === 0
          ? "No answer from radio. Is it switched on normally (not in update mode) and is the right port selected?"
          : `Unexpected answer to PROGRAM: ${hex(hello)}`,
      );
    }
    await t.write(Uint8Array.of(CMD_IDENT));
    const ident = parseIdent(await t.read(timeoutMs, 50));
    return new ProgramSession(t, ident);
  }

  /** Reads one block of at most 255 bytes, retrying transient errors. */
  async readBlock(address: number, length: number, attempts = 3): Promise<Uint8Array> {
    const expected = length + 8;
    for (let attempt = 1; ; attempt++) {
      await this.t.write(buildReadRequest(address, length));
      let reply = await this.t.read(1000);
      while (reply.length > 0 && reply.length < expected) {
        const more = await this.t.read(500);
        if (!more.length) break;
        const joined = new Uint8Array(reply.length + more.length);
        joined.set(reply);
        joined.set(more, reply.length);
        reply = joined;
      }
      try {
        return parseReadReply(reply, address, length);
      } catch (e) {
        if (attempt >= attempts) throw e;
        await this.t.read(50, 50);
        this.t.flushInput();
      }
    }
  }

  /** Leaves programming mode; the radio returns to normal operation. */
  async close(): Promise<void> {
    await this.t.write(LEAVE_PROGRAM);
    await this.t.read(1000, 50);
  }
}
