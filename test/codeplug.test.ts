import { describe, expect, it } from "vitest";
import { decodeDump, encodeDump, readCodeplug, type CodeplugRegion } from "../src/codeplug/dump";
import { D878UV_CODEPLUG, D878UV2_CODEPLUG } from "../src/codeplug/d878uv";
import { MODELS } from "../src/models";
import { buildReadRequest, parseReadReply, ProgramSession } from "../src/protocol/program";
import { hex } from "../src/protocol/anytone";
import { MockProgramRadio } from "./mock-program-radio";

const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe("read protocol", () => {
  it("builds the documented read request", () => {
    expect(hex(buildReadRequest(0x02fa0020, 0x10)).replace(/ /g, "")).toBe("5202fa002010");
  });

  it("parses the documented read reply", () => {
    const reply = fromHex("5702fa002010ffffffffffffffff00000000000000002406");
    expect(hex(parseReadReply(reply, 0x02fa0020, 16))).toBe("ff ff ff ff ff ff ff ff 00 00 00 00 00 00 00 00");
  });

  it("rejects a bad checksum", () => {
    const reply = fromHex("5702fa002010ffffffffffffffff00000000000000002506");
    expect(() => parseReadReply(reply, 0x02fa0020, 16)).toThrow(/Checksum/);
  });
});

const regions: CodeplugRegion[] = [
  { name: "a", address: 0x00800000, length: 0x40 },
  { name: "b", address: 0x02500000, length: 0x30 },
];
const mem = (a: number) => (a ^ (a >>> 8) ^ (a >>> 16)) & 0xff;

describe("codeplug backup", () => {
  it("reads every region and round-trips through the file format", async () => {
    const radio = new MockProgramRadio(mem);
    const session = await ProgramSession.open(radio);
    expect(session.ident.model).toBe("D878UV");
    const { header, data } = await readCodeplug(session, regions);
    await session.close();
    expect(radio.closed).toBe(true);
    expect(radio.reads).toBe(7);

    const decoded = decodeDump(encodeDump(header, data));
    expect(decoded.header.model).toBe("D878UV");
    for (const r of decoded.header.regions) {
      for (let i = 0; i < r.length; i++) expect(decoded.data[r.offset + i]).toBe(mem(r.address + i));
    }
  });

  it("retries a corrupted read", async () => {
    const radio = new MockProgramRadio(mem, { corruptRead: 2 });
    const session = await ProgramSession.open(radio);
    const { data } = await readCodeplug(session, regions);
    expect(radio.reads).toBe(8);
    expect(data[0x20]).toBe(mem(0x00800020));
  });

  it("explains a radio that is not in programming mode", async () => {
    const silent = new MockProgramRadio(mem);
    silent.write = async () => {};
    await expect(ProgramSession.open(silent)).rejects.toThrow(/switched on normally/);
  });

  it("detects a truncated file", () => {
    const file = encodeDump(
      { tool: "t", createdAt: "", model: "D878UV", hwVersion: "V100", ident: "", regions: [{ ...regions[0]!, offset: 0 }] },
      new Uint8Array(0x40),
    );
    expect(() => decodeDump(file.subarray(0, file.length - 1))).toThrow(/truncated/);
  });
});

describe("codeplug region maps", () => {
  it("D878UV covers qdmr's 130 regions plus 5 extra areas", () => {
    expect(D878UV_CODEPLUG.length).toBe(135);
    expect(D878UV_CODEPLUG.reduce((n, r) => n + r.length, 0)).toBe(2_232_608);
  });

  it("D878UVII differs from D878UV only in the contact ID map address", () => {
    const diff = D878UV2_CODEPLUG.filter((r, i) => r.address !== D878UV_CODEPLUG[i]!.address);
    expect(diff).toEqual([{ name: "contact ID map", address: 0x04800000, length: 0x13890 }]);
  });

  it.each(MODELS.filter((m) => m.codeplug).map((m) => [m.id, m.codeplug!] as const))(
    "%s map is sorted, aligned and non-overlapping",
    (_, regions) => {
      let end = 0;
      for (const r of regions) {
        expect(r.address % 16, r.name).toBe(0);
        expect(r.length % 16, r.name).toBe(0);
        expect(r.length, r.name).toBeGreaterThan(0);
        expect(r.address, r.name).toBeGreaterThanOrEqual(end);
        end = r.address + r.length;
      }
    },
  );
});
