import { ByteQueue, type Transport } from "../src/serial/transport";
import { ACK, BLOCK_SIZE, PACKET_SIZE } from "../src/protocol/anytone";

export interface MockRadioOptions {
  model?: string;
  hwVersion?: string;
  /** Zero-based packet indexes whose first transmission gets no reply. */
  dropAcks?: Set<number>;
  /** Packet indexes that are always NAKed. */
  failPackets?: Set<number>;
  silent?: boolean;
}

/** Simulates the D878UV bootloader and records what was flashed. */
export class MockRadio implements Transport {
  private rx = new ByteQueue();
  private pending: number[] = [];
  private inSession = false;
  private packetIndex = 0;
  private dropped = new Set<number>();
  readonly flash = new Map<number, number>();
  ended = false;
  packetsReceived = 0;

  constructor(private opts: MockRadioOptions = {}) {}

  async write(data: Uint8Array): Promise<void> {
    this.pending.push(...data);
    this.process();
  }

  read(timeoutMs: number, idleMs = 0) {
    // Real timeouts would make the retry tests slow; the mock answers synchronously.
    return this.rx.read(Math.min(timeoutMs, 20), Math.min(idleMs, 5));
  }

  flushInput() {
    this.rx.clear();
  }

  private reply(...bytes: number[]) {
    if (!this.opts.silent) this.rx.push(Uint8Array.from(bytes));
  }

  private process() {
    const p = this.pending;
    if (!this.inSession) {
      if (String.fromCharCode(...p.slice(0, 6)) === "UPDATE") {
        p.splice(0, 6);
        this.inSession = true;
        this.reply(ACK);
      }
      return;
    }
    while (p.length) {
      if (p[0] === 0x02) {
        p.shift();
        const model = this.opts.model ?? "D878UV";
        const hw = this.opts.hwVersion ?? "V100";
        this.reply(...[..."I" + model].map((c) => c.charCodeAt(0)), 0, 0, ...[...hw].map((c) => c.charCodeAt(0)), 0, 0, 0, ACK);
      } else if (p[0] === 0x18) {
        p.shift();
        this.ended = true;
        this.reply(ACK);
      } else if (p[0] === 0x01) {
        if (p.length < PACKET_SIZE) return;
        const pkt = p.splice(0, PACKET_SIZE);
        this.packetsReceived++;
        const idx = this.packetIndex;
        if (this.opts.dropAcks?.has(idx) && !this.dropped.has(idx)) {
          this.dropped.add(idx);
          continue;
        }
        if (this.opts.failPackets?.has(idx)) {
          this.reply(0x15);
          continue;
        }
        let sum = 0;
        for (let i = 1; i < 5 + BLOCK_SIZE; i++) sum += pkt[i]!;
        const ok =
          pkt[5 + BLOCK_SIZE] === (sum & 0xff) &&
          pkt[6 + BLOCK_SIZE] === ((sum >> 8) & 0xff) &&
          pkt[7 + BLOCK_SIZE] === ACK;
        if (!ok) {
          this.reply(0x15);
          continue;
        }
        const addr = (pkt[1]! | (pkt[2]! << 8) | (pkt[3]! << 16) | (pkt[4]! << 24)) >>> 0;
        for (let i = 0; i < BLOCK_SIZE; i++) this.flash.set(addr + i, pkt[5 + i]!);
        this.packetIndex++;
        this.reply(ACK);
      } else {
        p.shift();
      }
    }
  }
}
