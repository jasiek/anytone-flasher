import { describe, expect, it } from "vitest";
import { buildWritePacket, flashFirmware, hex, parseIdent } from "../src/protocol/anytone";
import type { FirmwareImage } from "../src/firmware/format";
import { MockRadio } from "./mock-radio";

const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe("buildWritePacket", () => {
  it("matches the packet captured from the official CPS", () => {
    // From at-d878uv_protocol.md in reald/anytone-flash-tools.
    const captured = "0100400008b83d0120e14b00082148000823480008274800082b4800082f48000800000000e70406";
    const data = fromHex(captured).subarray(5, 37);
    expect(hex(buildWritePacket(0x08004000, data)).replace(/ /g, "")).toBe(captured);
  });

  it("zero-pads a short final block", () => {
    const p = buildWritePacket(0x08000000, Uint8Array.of(1, 2, 3));
    expect(p.length).toBe(40);
    expect([...p.subarray(5, 37)]).toEqual([1, 2, 3, ...new Array(29).fill(0)]);
    const sum = 0x08 + 1 + 2 + 3;
    expect([p[37], p[38], p[39]]).toEqual([sum & 0xff, sum >> 8, 0x06]);
  });
});

describe("parseIdent", () => {
  it("parses the documented ident reply", () => {
    const id = parseIdent(fromHex("49443837385556000056313030000006"));
    expect(id).toMatchObject({ model: "D878UV", hwVersion: "V100", band: 0 });
  });

  it("reads a 7-character model in full", () => {
    // "ID878UV2" + band 0 + "V100" ... ACK
    const id = parseIdent(fromHex("49443837385556320056313030000006"));
    expect(id.model).toBe("D878UV2");
    expect(id.hwVersion).toBe("V100");
  });
});

function image(size: number, segments = [0x08004000]): FirmwareImage {
  const per = Math.ceil(size / segments.length);
  return {
    model: "D878UV",
    hwVersion: "V100",
    segments: segments.map((address, s) => {
      const len = Math.min(per, size - s * per);
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 7 + s * 13 + 3) & 0xff;
      return { address, data };
    }),
    size,
    trailingBytes: 0,
  };
}

function expectFlashed(radio: MockRadio, img: FirmwareImage) {
  let expectedSize = 0;
  for (const seg of img.segments) {
    for (let i = 0; i < seg.data.length; i++) {
      if (radio.flash.get(seg.address + i) !== seg.data[i]) throw new Error(`byte 0x${(seg.address + i).toString(16)} differs`);
    }
    const padded = Math.ceil(seg.data.length / 32) * 32;
    for (let i = seg.data.length; i < padded; i++) expect(radio.flash.get(seg.address + i)).toBe(0);
    expectedSize += padded;
  }
  expect(radio.flash.size).toBe(expectedSize);
}

describe("flashFirmware", () => {
  it("flashes a whole image and closes the session", async () => {
    const radio = new MockRadio();
    const img = image(32 * 50 + 13);
    const phases: string[] = [];
    let last = 0;
    await flashFirmware(radio, img, {
      onProgress: (p) => {
        if (phases.at(-1) !== p.phase) phases.push(p.phase);
        expect(p.bytesSent).toBeGreaterThanOrEqual(last);
        last = p.bytesSent;
      },
    });
    expectFlashed(radio, img);
    expect(radio.ended).toBe(true);
    expect(phases).toEqual(["handshake", "identify", "transfer", "finish", "done"]);
    expect(last).toBe(img.size);
  });

  it("flashes each segment at its own address", async () => {
    const radio = new MockRadio({ model: "D168UV" });
    const img = { ...image(32 * 20 + 7, [0x08004000, 0x08020000]), model: "D168UV" };
    await flashFirmware(radio, img);
    expectFlashed(radio, img);
    expect(radio.ended).toBe(true);
  });

  it("refuses D878UV firmware on a D878UVII", async () => {
    const radio = new MockRadio({ model: "D878UV2" });
    await expect(flashFirmware(radio, image(64))).rejects.toThrow(/Radio is a D878UV2, firmware is for D878UV/);
    expect(radio.packetsReceived).toBe(0);
  });

  it("accepts an MCU-variant build when the caller names the ident model", async () => {
    const radio = new MockRadio({ model: "D578UV" });
    const img = { ...image(64), model: "D578UVA" };
    await expect(flashFirmware(radio, img)).rejects.toThrow(/firmware is for D578UVA/);
    await flashFirmware(new MockRadio({ model: "D578UV" }), img, { identModel: "D578UV" });
  });

  it("retries a block whose ACK was lost", async () => {
    const radio = new MockRadio({ dropAcks: new Set([3, 7]) });
    const img = image(32 * 10);
    let retries = 0;
    await flashFirmware(radio, img, { onProgress: (p) => (retries = p.retries) });
    expectFlashed(radio, img);
    expect(retries).toBe(2);
    expect(radio.packetsReceived).toBe(12);
  });

  it("accepts a late ACK without resending", async () => {
    // The mock caps the ACK wait at 20 ms; the follow-up wait still catches a 30 ms ACK.
    const radio = new MockRadio({ lateAcks: new Map([[2, 30]]), dropAcks: new Set([5]) });
    const img = image(32 * 8);
    const log: string[] = [];
    await flashFirmware(radio, img, { onLog: (m) => log.push(m) });
    expectFlashed(radio, img);
    expect(radio.packetsReceived).toBe(9);
    expect(log.some((m) => /0x8004040: late ACK/.test(m))).toBe(true);
    expect(log.some((m) => /0x80040a0: timeout, retrying \(ACK avg/.test(m))).toBe(true);
    expect(log).toContainEqual(expect.stringMatching(/with 1 resends \(ACK avg/));
  });

  it("gives up after maxAttempts NAKs", async () => {
    const radio = new MockRadio({ failPackets: new Set([2]) });
    await expect(flashFirmware(radio, image(32 * 5))).rejects.toThrow(/0x8004040 failed after 5 attempts/);
    expect(radio.ended).toBe(false);
  });

  it("refuses firmware for another model", async () => {
    const radio = new MockRadio({ model: "D868UV" });
    await expect(flashFirmware(radio, image(64))).rejects.toThrow(/Radio is a D868UV/);
    expect(radio.packetsReceived).toBe(0);
  });

  it("refuses a hardware version mismatch", async () => {
    const radio = new MockRadio({ hwVersion: "V200" });
    await expect(flashFirmware(radio, image(64))).rejects.toThrow(/hardware V200/);
    expect(radio.packetsReceived).toBe(0);
  });

  it("explains a silent radio", async () => {
    await expect(flashFirmware(new MockRadio({ silent: true }), image(64))).rejects.toThrow(/No answer from radio/);
  });

  it("stops when aborted", async () => {
    const radio = new MockRadio();
    const ac = new AbortController();
    const run = flashFirmware(radio, image(32 * 1000), {
      signal: ac.signal,
      onProgress: (p) => p.phase === "transfer" && ac.abort(),
    });
    await expect(run).rejects.toThrow(/Aborted/);
    expect(radio.ended).toBe(false);
    expect(radio.packetsReceived).toBe(0);
  });
});
