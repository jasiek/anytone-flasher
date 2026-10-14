import "./style.css";
import { loadFirmware, loadManifest, type FirmwareEntry } from "./firmware/catalog";
import { MODELS, type RadioModel } from "./models";
import { flashFirmware, type FlashPhase, type FlashProgress } from "./protocol/anytone";
import { isWebSerialSupported, WebSerialTransport } from "./serial/webserial";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  unsupported: $("unsupported"),
  model: $<HTMLSelectElement>("model"),
  modelNotes: $("model-notes"),
  firmwareList: $("firmware-list"),
  updateKeys: $("update-keys"),
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
  steps: ["step-model", "step-firmware", "step-port"].map((id) => $(id)),
};

const state: {
  firmware: FirmwareEntry[];
  model: RadioModel | null;
  selected: FirmwareEntry | null;
  port: SerialPort | null;
  busy: boolean;
  abort: AbortController | null;
  showOlder: boolean;
} = { firmware: [], model: null, selected: null, port: null, busy: false, abort: null, showOlder: false };

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
}

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
  selectModel(MODELS[0]!.id);
}

function selectModel(id: string) {
  state.model = MODELS.find((m) => m.id === id) ?? null;
  state.showOlder = false;
  ui.modelNotes.textContent = state.model?.notes ?? "";
  ui.updateKeys.textContent = state.model?.updateModeKeys ?? "";
  renderFirmware();
}

function renderFirmware() {
  const list = state.firmware.filter((f) => f.modelId === state.model?.id);
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
      meta.textContent = [f.date, fmtBytes(f.size), `HW ${f.hwVersion}`].filter(Boolean).join(" · ");
      label.append(input, ver);
      if (i === 0) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "Latest";
        label.append(tag);
      }
      label.append(meta);
      if (f.notes) label.title = f.notes;
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

async function flash() {
  const { model, selected, port } = state;
  if (!model || !selected || !port) return;

  state.busy = true;
  state.abort = new AbortController();
  updateControls();
  ui.result.hidden = true;
  ui.progress.hidden = false;
  ui.progress.classList.remove("done", "failed");
  ui.barFill.style.width = "0";
  ui.percent.textContent = "0%";
  ui.stats.textContent = "";
  ui.phase.textContent = "Loading firmware…";

  let transport: WebSerialTransport | null = null;
  try {
    log(`Loading ${model.name} firmware V${selected.version}…`);
    const image = await loadFirmware(selected);
    log(`Firmware OK: ${image.model} HW ${image.hwVersion}, ${image.data.length} bytes, start 0x${image.startAddress.toString(16)}`);
    if (image.trailingBytes) log(`Ignoring ${image.trailingBytes} trailing bytes past the declared image size.`);

    ui.phase.textContent = "Opening port…";
    transport = await WebSerialTransport.open(port);
    log(`Opened ${describePort(port)}`);

    const startedAt = performance.now();
    await flashFirmware(transport, image, {
      signal: state.abort.signal,
      onLog: log,
      onProgress: (p) => renderProgress(p, startedAt),
      onIdent: (id) => {
        if (!model.hwVersions.includes(id.hwVersion)) {
          throw new Error(`Hardware version ${id.hwVersion} is not supported for ${model.name}`);
        }
      },
    });

    ui.progress.classList.add("done");
    showResult(
      "ok",
      `<strong>Firmware transferred.</strong>
       <p>Switch the radio off, then hold <kbd>${model.installKeys}</kbd> while switching it on to
       start the installer and confirm the update on the radio. Afterwards, write your codeplug back with the CPS
       version that matches V${selected.version}.</p>`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR: ${msg}`);
    ui.progress.classList.add("failed");
    ui.phase.textContent = "Failed";
    showResult(
      "danger",
      `<strong>Flashing failed:</strong> ${escapeHtml(msg)}
       <p>The radio's bootloader is untouched until you run the installer, so you can power-cycle it into
       update mode (<kbd>${model.updateModeKeys}</kbd>) and try again.</p>`,
    );
    ui.logWrap.open = true;
  } finally {
    await transport?.close();
    state.busy = false;
    state.abort = null;
    updateControls();
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function init() {
  if (!isWebSerialSupported()) ui.unsupported.hidden = false;

  ui.model.addEventListener("change", () => selectModel(ui.model.value));
  ui.pickPort.addEventListener("click", pickPort);
  ui.confirm.addEventListener("change", updateControls);
  ui.flash.addEventListener("click", flash);
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
    state.firmware = (await loadManifest()).firmware;
  } catch (e) {
    showResult("danger", escapeHtml(e instanceof Error ? e.message : String(e)));
  }
  renderModels();
}

init();
