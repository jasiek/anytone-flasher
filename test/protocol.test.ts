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
});

function image(size: number): FirmwareImage {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 7 + 3) & 0xff;
  return { model: "D878UV", hwVersion: "V100", startAddress: 0x08004000, data, trailingBytes: 0 };
}

function expectFlashed(radio: MockRadio, img: FirmwareImage) {
  for (let i = 0; i < img.data.length; i++) {
    if (radio.flash.get(img.startAddress + i) !== img.data[i]) throw new Error(`byte ${i} differs`);
  }
  const padded = Math.ceil(img.data.length / 32) * 32;
  for (let i = img.data.length; i < padded; i++) expect(radio.flash.get(img.startAddress + i)).toBe(0);
  expect(radio.flash.size).toBe(padded);
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
    expect(last).toBe(img.data.length);
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

  it("gives up after maxAttempts NAKs", async () => {
    const radio = new MockRadio({ failPackets: new Set([2]) });
    await expect(flashFirmware(radio, image(32 * 5))).rejects.toThrow(/0x8004040 failed after 3 attempts/);
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
