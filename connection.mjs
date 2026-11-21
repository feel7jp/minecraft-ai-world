export const SERVER_PORT = 443;
export const SERVER_NAME = "AIの世界";

const GITHUB_API = "https://api.github.com/repos/feel7jp/minecraft-ai-world/contents/connection.json";

export function validateConnectionMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schema !== 1 || value.ready !== true || value.server_port !== SERVER_PORT) return null;
  if (typeof value.updated_at !== "string" || !Number.isFinite(Date.parse(value.updated_at))) return null;
  if (typeof value.server_url !== "string") return null;

  let parsed;
  try {
    parsed = new URL(value.server_url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  const suffix = ".trycloudflare.com";
  const subdomain = host.endsWith(suffix) ? host.slice(0, -suffix.length) : "";
  const validQuickTunnel = subdomain && !subdomain.includes(".") && subdomain.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain);

  // Require a plain HTTPS tunnel origin. A port belongs in server_port, not in this URL.
  if (
    parsed.protocol !== "https:" ||
    !validQuickTunnel ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    value.server_url !== `https://${host}`
  ) return null;

  return Object.freeze({
    schema: 1,
    server_url: `https://${host}`,
    server_port: SERVER_PORT,
    updated_at: value.updated_at,
    ready: true,
  });
}

export function buildConnectUri(serverHost) {
  return `minecraft://connect?serverUrl=${encodeURIComponent(serverHost)}&serverPort=${SERVER_PORT}`;
}

export function buildAddServerUri(serverHost) {
  const server = `${SERVER_NAME}|${serverHost}:${SERVER_PORT}`;
  return `minecraft://?addExternalServer=${encodeURIComponent(server)}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    mode: "cors",
    signal: AbortSignal.timeout(8000),
    ...options,
  });
  if (!response.ok) throw new Error(`status-${response.status}`);
  return response.json();
}

export async function fetchConnectionMetadata(lastKnown = null) {
  const now = Date.now();
  const sources = [
    () => fetchJson(`${GITHUB_API}?_=${now}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
    }),
    () => fetchJson(`./connection.json?_=${now}`),
  ];

  const minimum = Date.parse(lastKnown?.updated_at ?? "") || 0;
  let latest = null;
  const reads = sources.map(async load => {
    const metadata = validateConnectionMetadata(await load());
    const updated = Date.parse(metadata?.updated_at ?? "");
    if (!metadata || updated < minimum ||
        (updated === minimum && metadata.server_url !== lastKnown?.server_url)) {
      throw new Error("invalid-or-stale-connection");
    }
    if (!latest || updated > Date.parse(latest.updated_at)) latest = metadata;
  });

  try {
    await Promise.any(reads);
  } catch {
    throw new Error("connection-unavailable");
  }
  // Give the other copies a short chance to return a newer destination.
  await Promise.race([Promise.allSettled(reads), new Promise(resolve => setTimeout(resolve, 300))]);
  return latest;
}

if (typeof document !== "undefined") {
  const play = document.querySelector("#play");
  const playLabel = document.querySelector("#play-label");
  const status = document.querySelector("#status");
  const retry = document.querySelector("#retry");
  const register = document.querySelector("#register");
  const address = document.querySelector("#address");
  const copy = document.querySelector("#copy");
  let currentServerHost = null;
  let lastKnown = null;
  let loadSequence = 0;

  function showLoading() {
    currentServerHost = null;
    play.disabled = true;
    register.removeAttribute("href");
    register.setAttribute("aria-disabled", "true");
    address.textContent = "接続先を見つけているよ…";
    copy.disabled = true;
    playLabel.textContent = "世界をさがしているよ…";
    status.classList.remove("error");
    status.textContent = "接続先を見つけているよ…";
    retry.hidden = true;
  }

  function showUnavailable() {
    playLabel.textContent = "いまは見つからないみたい";
    address.textContent = "接続先を見つけられなかったよ";
    status.classList.add("error");
    status.textContent = "少し時間をおいて、もう一度ためしてね。";
    retry.hidden = false;
  }

  async function loadConnection() {
    const sequence = ++loadSequence;
    showLoading();
    try {
      const metadata = await fetchConnectionMetadata(lastKnown);
      if (sequence !== loadSequence) return;
      lastKnown = metadata;
      // Minecraft's address field needs a hostname; its port is passed separately.
      currentServerHost = new URL(metadata.server_url).hostname;
      play.disabled = false;
      playLabel.textContent = "あそぶ！";
      register.href = buildAddServerUri(currentServerHost);
      register.setAttribute("aria-disabled", "false");
      address.textContent = currentServerHost;
      copy.disabled = false;
      status.classList.remove("error");
      status.textContent = "接続先を見つけたよ";
      retry.hidden = true;
    } catch {
      if (sequence === loadSequence) showUnavailable();
    }
  }

  play.addEventListener("click", () => {
    if (!currentServerHost) return;
    window.location.href = buildConnectUri(currentServerHost);
  });

  retry.addEventListener("click", loadConnection);

  // A home-screen page can resume after the PC has restarted. Re-read its
  // destination when returning from Minecraft instead of retaining an old URL.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadConnection();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) loadConnection();
  });

  copy.addEventListener("click", async () => {
    if (!currentServerHost) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(currentServerHost);
      status.textContent = "住所をコピーしたよ";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(address);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = "住所を選んだよ。長押ししてコピーしてね。";
    }
  });

  loadConnection();
}
