import { ByteQueue, type Transport } from "../src/serial/transport";

/** Simulates a D878UV switched on normally, serving reads from a memory function. */
export class MockProgramRadio implements Transport {
  private rx = new ByteQueue();
  private pending: number[] = [];
  private inSession = false;
  reads = 0;
  closed = false;

  constructor(
    private memory: (addr: number) => number = (a) => (a * 31 + (a >>> 8)) & 0xff,
    private opts: { corruptRead?: number; model?: string } = {},
  ) {}

  async write(data: Uint8Array) {
    this.pending.push(...data);
    this.process();
  }

  read(timeoutMs: number, idleMs = 0) {
    return this.rx.read(Math.min(timeoutMs, 20), Math.min(idleMs, 5));
  }

  flushInput() {
    this.rx.clear();
  }

  private reply(bytes: number[]) {
    this.rx.push(Uint8Array.from(bytes));
  }

  private process() {
    const p = this.pending;
    const ascii = (n: number) => String.fromCharCode(...p.slice(0, n));
    while (p.length) {
      if (!this.inSession) {
        if (p.length < 7) return;
        if (ascii(7) === "PROGRAM") {
          p.splice(0, 7);
          this.inSession = true;
          this.reply([0x51, 0x58, 0x06]);
        } else p.shift();
      } else if (p[0] === 0x02) {
        p.shift();
        const id = "I" + (this.opts.model ?? "D878UV");
        this.reply([...[...id].map((c) => c.charCodeAt(0)), 0, 0, ...[..."V100"].map((c) => c.charCodeAt(0)), 0, 0, 0, 6]);
      } else if (p[0] === 0x52) {
        if (p.length < 6) return;
        const [, a3, a2, a1, a0, len] = p.splice(0, 6) as number[];
        const addr = ((a3! << 24) | (a2! << 16) | (a1! << 8) | a0!) >>> 0;
        const data = Array.from({ length: len! }, (_, i) => this.memory(addr + i));
        const body = [a3!, a2!, a1!, a0!, len!, ...data];
        let sum = body.reduce((s, b) => s + b, 0) & 0xff;
        if (this.reads++ === this.opts.corruptRead) sum ^= 0xff;
        this.reply([0x57, ...body, sum, 0x06]);
      } else if (ascii(3) === "END") {
        p.splice(0, 3);
        this.inSession = false;
        this.closed = true;
        this.reply([0x06]);
      } else if (p.length < 3) return;
      else p.shift();
    }
  }
}
