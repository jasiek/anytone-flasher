import { describe, expect, it } from "vitest";
import { issueUrl, MAX_URL_LENGTH, REPO_URL } from "../src/report";

const parse = (u: string) => {
  const url = new URL(u);
  return { base: `${url.origin}${url.pathname}`, title: url.searchParams.get("title")!, body: url.searchParams.get("body")! };
};

describe("issueUrl", () => {
  const info = {
    model: "AnyTone AT-D878UV / UV Plus",
    firmware: "V4.00 (2025-07-25)",
    port: "USB device 28e9:018a",
    userAgent: "Mozilla/5.0 (Macintosh) Chrome/141",
    appVersion: "abc1234",
  };

  it("prefills title, details and the whole short log", () => {
    const log = "[18:29:15] Sending \"UPDATE\"…\n[18:29:33] ERROR: Block at 0x8004040 failed after 5 attempts\n";
    const r = parse(issueUrl({ ...info, log }));
    expect(r.base).toBe(`${REPO_URL}/issues/new`);
    expect(r.title).toBe("AnyTone AT-D878UV / UV Plus: Block at 0x8004040 failed after 5 attempts");
    expect(r.body).toContain("- Port: USB device 28e9:018a");
    expect(r.body).toContain("- App version: abc1234");
    expect(r.body).toContain(log.trimEnd());
    expect(r.body).not.toContain("omitted");
  });

  it("cuts the middle of a long log but keeps its start and the error", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `[18:29:${i}] Block 0x${(0x8004000 + i * 32).toString(16)}: timeout, retrying`);
    lines.push("[18:30:00] ERROR: Aborted by user");
    const u = issueUrl({ ...info, log: lines.join("\n") });
    expect(u.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    const { body } = parse(u);
    expect(body).toContain(lines[0]);
    expect(body).toContain("ERROR: Aborted by user");
    expect(body).toMatch(/… \d+ lines omitted …/);
    expect(body).toContain("Copy log");
  });

  it("works without a log or a model", () => {
    expect(parse(issueUrl({ log: "" })).title).toBe("Flasher: problem report");
  });
});
