import { ByteQueue, type Transport } from "./transport";

// The radio is a USB CDC-ACM device, so the baud rate is ignored by the
// hardware. 4 Mbaud matches the reference tool that was tested on real radios.
export const DEFAULT_BAUD_RATE = 4_000_000;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export class WebSerialTransport implements Transport {
  private queue = new ByteQueue();
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoop: Promise<void> | null = null;

  private constructor(readonly port: SerialPort) {}

  static async open(port: SerialPort, baudRate = DEFAULT_BAUD_RATE): Promise<WebSerialTransport> {
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    const t = new WebSerialTransport(port);
    t.startReading();
    return t;
  }

  private startReading() {
    const readable = this.port.readable;
    if (!readable) throw new Error("Serial port is not readable");
    const reader = readable.getReader();
    this.reader = reader;
    this.readLoop = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this.queue.push(value);
        }
        this.queue.close(new Error("Serial port closed"));
      } catch (e) {
        this.queue.close(e instanceof Error ? e : new Error(String(e)));
      } finally {
        reader.releaseLock();
      }
    })();
  }

  async write(data: Uint8Array): Promise<void> {
    const writable = this.port.writable;
    if (!writable) throw new Error("Serial port is not writable");
    const writer = writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  read(timeoutMs: number, idleMs = 0): Promise<Uint8Array> {
    return this.queue.read(timeoutMs, idleMs);
  }

  flushInput(): void {
    this.queue.clear();
  }

  async close(): Promise<void> {
    try {
      await this.reader?.cancel();
      await this.readLoop;
    } catch {
      // The port may already be gone (radio unplugged or powered off).
    }
    try {
      await this.port.close();
    } catch {
      // Same as above.
    }
  }
}
