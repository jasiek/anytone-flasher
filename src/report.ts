// "Report a problem" link: a prefilled GitHub issue carrying the log.

export const REPO_URL = "https://github.com/jasiek/anytone-flasher";

/** GitHub rejects issue URLs much longer than ~8 KB; stay well under it. */
export const MAX_URL_LENGTH = 7000;

export interface ReportInfo {
  log: string;
  /** e.g. "AnyTone AT-D878UV / UV Plus" */
  model?: string;
  firmware?: string;
  port?: string;
  userAgent?: string;
  appVersion?: string;
}

function body(info: ReportInfo, log: string, truncated: boolean) {
  const fields = [
    ["Radio", info.model],
    ["Firmware", info.firmware],
    ["Port", info.port],
    ["Browser", info.userAgent],
    ["App version", info.appVersion],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  return `**What happened?**

<!-- Describe what you were doing and what went wrong. -->

**Details**

${fields}

**Log**${truncated ? " (middle lines cut to fit the link; use Copy log to paste the full log)" : ""}

\`\`\`
${log.trimEnd()}
\`\`\`
`;
}

function url(title: string, text: string) {
  const q = new URLSearchParams({ title, body: text, labels: "bug" });
  return `${REPO_URL}/issues/new?${q}`;
}

/**
 * Builds a new-issue URL. A long log keeps its first and last lines (the setup
 * and the error) and loses the middle, so the URL stays under MAX_URL_LENGTH.
 */
export function issueUrl(info: ReportInfo): string {
  const lines = info.log.trimEnd().split("\n");
  const error = [...lines].reverse().find((l) => /ERROR: /.test(l))?.replace(/^.*?ERROR: /, "");
  const title = `${info.model ?? "Flasher"}: ${error ?? "problem report"}`.slice(0, 120);
  let full = url(title, body(info, lines.join("\n"), false));
  if (full.length <= MAX_URL_LENGTH) return full;
  const head = Math.min(8, lines.length);
  for (let tail = lines.length - head; tail >= 0; tail--) {
    const kept = [...lines.slice(0, head), `… ${lines.length - head - tail} lines omitted …`, ...lines.slice(lines.length - tail)];
    full = url(title, body(info, kept.join("\n"), true));
    if (full.length <= MAX_URL_LENGTH) return full;
  }
  return url(title, body(info, "(log too long; paste it here)", true));
}
