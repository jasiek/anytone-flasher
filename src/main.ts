import "./style.css";
import { groupReleases, loadFirmware, loadManifest, selectBuild, type FirmwareRelease } from "./firmware/catalog";
import { MCU_LABEL, MODELS, type RadioModel } from "./models";
import { dumpFileName, downloadFile, encodeDump, readCodeplug, totalSize, type DumpProgress } from "./codeplug/dump";
import { FlashError, flashFirmware, hex, type FlashPhase, type FlashProgress } from "./protocol/anytone";
import { ProgramSession } from "./protocol/program";
import { issueUrl } from "./report";
import { isWebSerialSupported, WebSerialTransport } from "./serial/webserial";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  unsupported: $("unsupported"),
  model: $<HTMLSelectElement>("model"),
  modelNotes: $("model-notes"),
  firmwareList: $("firmware-list"),
  connectSteps: $("connect-steps"),
  backup: $<HTMLInputElement>("backup"),
  backupOnly: $<HTMLButtonElement>("backup-only"),
  pause: $("pause"),
  pauseText: $("pause-text"),
  continueBtn: $<HTMLButtonElement>("continue"),
  pickPort: $<HTMLButtonElement>("pick-port"),
  portLabel: $("port-label"),
  confirm: $<HTMLInputElement>("confirm-backup"),
  flash: $<HTMLButtonElement>("flash"),
  cancel: $<HTMLButtonElement>("cancel"),
  progress: $("progress"),
  phase: $("phase"),
  percent: $("percent"),
  barFill: $("bar-fill"),
  stats: $("stats"),
  result: $("result"),
  logWrap: $<HTMLDetailsElement>("log-wrap"),
  log: $("log"),
  report: $("report"),
  reportIssue: $<HTMLAnchorElement>("report-issue"),
  copyLog: $<HTMLButtonElement>("copy-log"),
  copyStatus: $("copy-status"),
  steps: ["step-model", "step-firmware", "step-port"].map((id) => $(id)),
};

const state: {
  releases: FirmwareRelease[];
  model: RadioModel | null;
  selected: FirmwareRelease | null;
  port: SerialPort | null;
  busy: boolean;
  abort: AbortController | null;
  showOlder: boolean;
} = { releases: [], model: null, selected: null, port: null, busy: false, abort: null, showOlder: false };

/** Releases listed before the "older versions" toggle. */
const RECENT_COUNT = 5;

const PHASE_LABELS: Record<FlashPhase, string> = {
  handshake: "Connecting to radio…",
  identify: "Identifying radio…",
  transfer: "Writing firmware…",
  finish: "Finishing…",
  done: "Transfer complete",
};

function log(msg: string) {
  const t = new Date().toLocaleTimeString();
  ui.log.textContent += `[${t}] ${msg}\n`;
  ui.log.scrollTop = ui.log.scrollHeight;
  ui.report.hidden = false;
}

// The link is built when clicked so it carries the log as it is then.
ui.reportIssue.addEventListener("click", () => {
  const release = state.selected;
  ui.reportIssue.href = issueUrl({
    log: ui.log.textContent ?? "",
    model: state.model?.name,
    firmware: release ? `V${release.version}${release.date ? ` (${release.date})` : ""}` : undefined,
    port: state.port ? describePort(state.port) : undefined,
    userAgent: navigator.userAgent,
    appVersion: __APP_VERSION__,
  });
});

ui.copyLog.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ui.log.textContent ?? "");
    ui.copyStatus.textContent = "Copied.";
  } catch {
    ui.copyStatus.textContent = "Could not copy; select the log text instead.";
    ui.logWrap.open = true;
  }
  setTimeout(() => (ui.copyStatus.textContent = ""), 3000);
});

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

function fmtDuration(s: number) {
  if (!Number.isFinite(s)) return "–";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}m ${r.toString().padStart(2, "0")}s` : `${r}s`;
}

function describePort(port: SerialPort) {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined) return "Serial port selected";
  const h = (n?: number) => (n ?? 0).toString(16).padStart(4, "0");
  return `USB device ${h(usbVendorId)}:${h(usbProductId)}`;
}

function renderModels() {
  ui.model.replaceChildren(
    ...MODELS.map((m) => {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name;
      return o;
    }),
  );
  // Radio landing pages link here with ?model=<id>.
  const wanted = new URLSearchParams(location.search).get("model");
  const initial = MODELS.find((m) => m.id === wanted) ?? MODELS[0]!;
  ui.model.value = initial.id;
  selectModel(initial.id);
}

function selectModel(id: string) {
  state.model = MODELS.find((m) => m.id === id) ?? null;
  state.showOlder = false;
  ui.modelNotes.textContent = state.model?.notes ?? "";
  ui.backup.disabled = !state.model?.codeplug?.length;
  if (ui.backup.disabled) ui.backup.checked = false;
  renderConnectSteps();
  renderFirmware();
}

function renderFirmware() {
  const list = state.releases.filter((f) => f.modelId === state.model?.id);
  if (!state.selected || !list.includes(state.selected)) state.selected = list[0] ?? null;
  if (!list.length) {
    ui.firmwareList.innerHTML = `<p class="muted">No firmware bundled for this model.</p>`;
    updateControls();
    return;
  }
  const selectedIndex = state.selected ? list.indexOf(state.selected) : 0;
  const visible = state.showOlder ? list : list.slice(0, Math.max(RECENT_COUNT, selectedIndex + 1));
  const items: HTMLElement[] = visible.map((f, i) => {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "firmware";
      input.checked = f === state.selected;
      input.addEventListener("change", () => {
        state.selected = f;
        updateControls();
      });
      const ver = document.createElement("span");
      ver.className = "ver";
      ver.textContent = `V${f.version}`;
      const meta = document.createElement("span");
      meta.className = "meta";
      const b = f.builds[0]!;
      const mcus = f.builds.map((x) => x.mcu && MCU_LABEL[x.mcu]).filter(Boolean);
      meta.textContent = [
        f.date,
        f.builds.length === 1 ? fmtBytes(b.size) : null,
        mcus.length ? `${mcus.join(" + ")}${mcus.length === 1 ? " only" : ""}` : null,
        `HW ${b.hwVersion}`,
      ]
        .filter(Boolean)
        .join(" · ");
      label.append(input, ver);
      if (i === 0) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "Latest";
        label.append(tag);
      }
      label.append(meta);
      if (b.notes) label.title = b.notes;
      return label;
    });
  const hidden = list.length - visible.length;
  if (hidden > 0 || state.showOlder) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "link";
    toggle.textContent = state.showOlder ? "Show fewer versions" : `Show ${hidden} older versions`;
    toggle.addEventListener("click", () => {
      state.showOlder = !state.showOlder;
      renderFirmware();
    });
    items.push(toggle);
  }
  ui.firmwareList.replaceChildren(...items);
  updateControls();
}

function updateControls() {
  const ready = !!(state.model && state.selected && state.port && ui.confirm.checked);
  ui.flash.disabled = state.busy || !ready || !isWebSerialSupported();
  ui.backupOnly.disabled =
    state.busy || !state.port || !state.model?.codeplug?.length || !isWebSerialSupported();
  ui.backup.disabled = state.busy || !state.model?.codeplug?.length;
  ui.pickPort.disabled = state.busy || !isWebSerialSupported();
  ui.model.disabled = state.busy;
  ui.confirm.disabled = state.busy;
  ui.firmwareList.querySelectorAll("input, button").forEach((i) => ((i as HTMLInputElement).disabled = state.busy));
  ui.cancel.hidden = !state.busy;
  ui.steps.forEach((s) => s.classList.toggle("disabled", state.busy));
}

async function pickPort() {
  try {
    state.port = await navigator.serial.requestPort();
    ui.portLabel.textContent = describePort(state.port);
    ui.portLabel.classList.remove("muted");
  } catch (e) {
    // NotFoundError means the user closed the picker without choosing.
    if (!(e instanceof DOMException && e.name === "NotFoundError")) showResult("danger", String(e));
  }
  updateControls();
}

function showResult(kind: "ok" | "danger", html: string) {
  ui.result.className = `banner ${kind}`;
  ui.result.innerHTML = html;
  ui.result.hidden = false;
}

function renderProgress(p: FlashProgress, startedAt: number) {
  const pct = p.totalBytes ? (p.bytesSent / p.totalBytes) * 100 : 0;
  ui.phase.textContent = PHASE_LABELS[p.phase];
  ui.percent.textContent = `${pct.toFixed(1)}%`;
  ui.barFill.style.width = `${pct}%`;
  const elapsed = (performance.now() - startedAt) / 1000;
  const rate = elapsed > 0 ? p.bytesSent / elapsed : 0;
  const eta = rate > 0 ? (p.totalBytes - p.bytesSent) / rate : NaN;
  ui.stats.textContent =
    `${fmtBytes(p.bytesSent)} / ${fmtBytes(p.totalBytes)} · ${fmtBytes(rate)}/s · ` +
    `elapsed ${fmtDuration(elapsed)} · remaining ${fmtDuration(eta)}` +
    (p.retries ? ` · ${p.retries} retries` : "");
}

function resetProgress(label: string) {
  ui.progress.hidden = false;
  ui.progress.classList.remove("done", "failed");
  ui.barFill.style.width = "0";
  ui.percent.textContent = "0%";
  ui.stats.textContent = "";
  ui.phase.textContent = label;
}

function renderDumpProgress(p: DumpProgress, startedAt: number) {
  renderProgress({ phase: "transfer", bytesSent: p.bytesRead, totalBytes: p.totalBytes, retries: 0 }, startedAt);
  ui.phase.textContent = p.region ? `Reading codeplug: ${p.region}` : "Codeplug read";
}

/** Shows a prompt with a Continue button; resolves on Continue, rejects on Cancel. */
function waitForContinue(html: string, signal: AbortSignal): Promise<void> {
  ui.pauseText.innerHTML = html;
  ui.pause.hidden = false;
  ui.continueBtn.focus();
  return new Promise((resolve, reject) => {
    const done = () => {
      ui.pause.hidden = true;
      ui.continueBtn.removeEventListener("click", onContinue);
      signal.removeEventListener("abort", onAbort);
    };
    const onContinue = () => {
      done();
      resolve();
    };
    const onAbort = () => {
      done();
      reject(new FlashError("Aborted by user"));
    };
    ui.continueBtn.addEventListener("click", onContinue);
    signal.addEventListener("abort", onAbort);
  });
}

/**
 * Power-cycling the radio re-enumerates its USB port, so the SerialPort we
 * had may be stale. Prefer an already-granted port with the same USB IDs and
 * fall back to the picker (we are inside the Continue click, so it may open).
 */
async function reacquirePort(previous: SerialPort): Promise<SerialPort> {
  const { usbVendorId, usbProductId } = previous.getInfo();
  const granted = await navigator.serial.getPorts();
  if (granted.includes(previous)) return previous;
  const same = granted.filter((p) => {
    const i = p.getInfo();
    return usbVendorId !== undefined && i.usbVendorId === usbVendorId && i.usbProductId === usbProductId;
  });
  if (same.length === 1) return same[0]!;
  log("Radio port changed after restart; asking for it again.");
  return navigator.serial.requestPort(usbVendorId !== undefined ? { filters: [{ usbVendorId }] } : undefined);
}

async function backupCodeplug(model: RadioModel, port: SerialPort, signal: AbortSignal): Promise<string> {
  const regions = model.codeplug;
  if (!regions?.length) throw new Error(`Codeplug backup is not available for ${model.name}`);
  resetProgress("Connecting in programming mode…");
  const transport = await WebSerialTransport.open(port);
  try {
    const session = await ProgramSession.open(transport);
    const { ident } = session;
    log(`Radio reports model ${ident.model}, hardware ${ident.hwVersion} (${hex(ident.raw)})`);
    if (ident.model !== model.identModel || !model.hwVersions.includes(ident.hwVersion)) {
      await session.close();
      throw new FlashError(`The radio reports ${ident.model} ${ident.hwVersion}, but ${model.name} is selected`);
    }
    log(`Reading ${regions.length} regions, ${fmtBytes(totalSize(regions))}…`);
    const startedAt = performance.now();
    let dump;
    try {
      dump = await readCodeplug(session, regions, { signal, onProgress: (p) => renderDumpProgress(p, startedAt) });
    } finally {
      await session.close().catch(() => {});
    }
    const name = dumpFileName(ident);
    downloadFile(name, encodeDump(dump.header, dump.data));
    log(`Codeplug saved as ${name}`);
    ui.progress.classList.add("done");
    return name;
  } finally {
    await transport.close();
  }
}

async function flashImage(model: RadioModel, release: FirmwareRelease, port: SerialPort, signal: AbortSignal) {
  resetProgress("Loading firmware…");
  const build = selectBuild(release, port.getInfo().usbVendorId);
  log(
    `Loading ${model.name} firmware V${release.version}` +
      (build.mcu ? ` (${MCU_LABEL[build.mcu]} build, chosen from the port's USB ID)` : "") +
      "…",
  );
  const image = await loadFirmware(build);
  const where = image.segments.map((s) => `0x${s.address.toString(16)}`).join(", ");
  log(`Firmware OK: ${image.model} HW ${image.hwVersion}, ${image.size} bytes at ${where}`);
  if (image.trailingBytes) log(`Ignoring ${image.trailingBytes} trailing bytes past the declared image size.`);

  ui.phase.textContent = "Opening port…";
  const transport = await WebSerialTransport.open(port);
  log(`Opened ${describePort(port)}`);
  try {
    const startedAt = performance.now();
    await flashFirmware(transport, image, {
      signal,
      identModel: model.identModel,
      onLog: log,
      onProgress: (p) => renderProgress(p, startedAt),
      onIdent: (id) => {
        if (!model.hwVersions.includes(id.hwVersion)) {
          throw new Error(`Hardware version ${id.hwVersion} is not supported for ${model.name}`);
        }
      },
    });
  } finally {
    await transport.close();
  }
  ui.progress.classList.add("done");
}

async function run(mode: "flash" | "backup-only") {
  const { model, selected } = state;
  let port = state.port;
  if (!model || !port || (mode === "flash" && !selected)) return;
  const backup = mode === "backup-only" || ui.backup.checked;

  state.busy = true;
  state.abort = new AbortController();
  const { signal } = state.abort;
  updateControls();
  ui.result.hidden = true;

  let stage: "backup" | "flash" = backup ? "backup" : "flash";
  try {
    // Fail before the backup and power cycle if this radio's MCU has no build.
    if (mode === "flash") {
      stage = "flash";
      selectBuild(selected!, port.getInfo().usbVendorId);
      stage = backup ? "backup" : "flash";
    }
    let saved: string | null = null;
    if (backup) {
      saved = await backupCodeplug(model, port, signal);
      if (mode === "backup-only") {
        showResult("ok", `<strong>Codeplug saved</strong> as <code>${escapeHtml(saved)}</code>.`);
        return;
      }
      await waitForContinue(
        `<strong>Backup saved as <code>${escapeHtml(saved)}</code>.</strong>
         <p>Now restart the radio in update mode. ${escapeHtml(model.updateMode)} Then press Continue.</p>`,
        signal,
      );
      port = await reacquirePort(port);
      state.port = port;
      ui.portLabel.textContent = describePort(port);
    }
    stage = "flash";
    await flashImage(model, selected!, port, signal);
    showResult(
      "ok",
      `<strong>Firmware transferred.</strong>
       <p>To install it: ${escapeHtml(model.install)} Afterwards, write your codeplug back with the CPS
       version that matches V${selected!.version}.</p>` +
        (saved ? `<p>Your backup is in <code>${escapeHtml(saved)}</code>.</p>` : ""),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    ui.progress.classList.add("failed");
    ui.phase.textContent = "Failed";
    showResult(
      "danger",
      stage === "backup"
        ? `<strong>Backup failed:</strong> ${escapeHtml(msg)}
           <p>Nothing was flashed. Switch the radio on normally (no keys held) and try again, or untick the backup
           option if you have saved the codeplug with the CPS.</p>`
        : `<strong>Flashing failed:</strong> ${escapeHtml(msg)}
           <p>The radio's bootloader is untouched until you run the installer, so you can restart it in
           update mode and try again. ${escapeHtml(model.updateMode)}</p>`,
    );
    ui.logWrap.open = true;
  } finally {
    ui.pause.hidden = true;
    state.busy = false;
    state.abort = null;
    updateControls();
  }
}

function renderConnectSteps() {
  const updateMode = escapeHtml(state.model?.updateMode ?? "");
  const steps = ui.backup.checked
    ? [
        "Connect the programming cable and switch the radio on normally.",
        "Pick its serial port. The codeplug is read and saved first.",
        `When asked, restart it in firmware-update mode: ${updateMode}`,
      ]
    : [
        "Connect the programming cable.",
        `Start the radio in firmware-update mode: ${updateMode}`,
        "Pick its serial port.",
      ];
  ui.connectSteps.innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function init() {
  if (!isWebSerialSupported()) ui.unsupported.hidden = false;

  ui.model.addEventListener("change", () => selectModel(ui.model.value));
  ui.pickPort.addEventListener("click", pickPort);
  ui.confirm.addEventListener("change", updateControls);
  ui.flash.addEventListener("click", () => run("flash"));
  ui.backupOnly.addEventListener("click", () => run("backup-only"));
  ui.backup.addEventListener("change", renderConnectSteps);
  ui.cancel.addEventListener("click", () => {
    state.abort?.abort();
    log("Cancelling…");
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.busy) e.preventDefault();
  });
  navigator.serial?.addEventListener("disconnect", (e) => {
    if (e.target === state.port && !state.busy) {
      state.port = null;
      ui.portLabel.textContent = "Port disconnected. Select it again.";
      ui.portLabel.classList.add("muted");
      updateControls();
    }
  });

  try {
    state.releases = groupReleases((await loadManifest()).firmware);
  } catch (e) {
    showResult("danger", escapeHtml(e instanceof Error ? e.message : String(e)));
  }
  renderModels();
}

init();
