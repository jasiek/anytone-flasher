/** Minimal byte-stream interface the flasher needs; Web Serial and test mocks implement it. */
export interface Transport {
  write(data: Uint8Array): Promise<void>;
  /**
   * Waits up to `timeoutMs` for the first byte, then keeps collecting until no
   * new byte has arrived for `idleMs` (0 = return whatever is already buffered).
   * Resolves with an empty array on timeout.
   */
  read(timeoutMs: number, idleMs?: number): Promise<Uint8Array>;
  /** Drops any buffered, unread input. */
  flushInput(): void;
}

/**
 * Byte FIFO fed by a producer (a serial read loop) and drained by Transport.read.
 * Shared by the Web Serial transport and the test mock radio.
 */
export class ByteQueue {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private waiter: (() => void) | null = null;
  private closedError: Error | null = null;

  push(data: Uint8Array) {
    if (data.length === 0) return;
    this.chunks.push(data);
    this.length += data.length;
    this.wake();
  }

  close(err: Error) {
    this.closedError = err;
    this.wake();
  }

  clear() {
    this.chunks = [];
    this.length = 0;
  }

  async read(timeoutMs: number, idleMs = 0): Promise<Uint8Array> {
    if (!(await this.waitForData(timeoutMs))) return new Uint8Array(0);
    if (idleMs > 0) {
      let seen = this.length;
      while (await this.waitForData(idleMs, seen)) seen = this.length;
    }
    return this.take();
  }

  /** Resolves true once more than `have` bytes are buffered, false on timeout. */
  private waitForData(timeoutMs: number, have = 0): Promise<boolean> {
    if (this.length > have) return Promise.resolve(true);
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve(false);
      }, timeoutMs);
      this.waiter = () => {
        if (this.closedError && this.length <= have) {
          clearTimeout(timer);
          this.waiter = null;
          reject(this.closedError);
        } else if (this.length > have) {
          clearTimeout(timer);
          this.waiter = null;
          resolve(true);
        }
      };
    });
  }

  private wake() {
    this.waiter?.();
  }

  private take(): Uint8Array {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    this.clear();
    return out;
  }
}
