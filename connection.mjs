export const SERVER_PORT = 443;
export const SERVER_NAME = "AIの世界";

const GITHUB_API = "https://api.github.com/repos/feel7jp/minecraft-ai-world/contents/connection.json";
const GITHUB_RAW = "https://raw.githubusercontent.com/feel7jp/minecraft-ai-world/main/connection.json";
const RECHECK_AFTER_MS = 60000;
const CONNECTION_KEY = "minecraft-ai-world-destination";

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      mode: "cors",
      signal: controller.signal,
      ...options,
    });
    if (!response.ok) throw new Error(`status-${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchConnectionMetadata(lastKnown = null) {
  const now = Date.now();
  const sources = [
    { primary: true, load: () => fetchJson(`${GITHUB_API}?_=${now}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
    }) },
    { primary: true, load: () => fetchJson(`${GITHUB_RAW}?_=${now}`) },
    { primary: false, load: () => fetchJson(`./connection.json?_=${now}`) },
  ];

  const minimum = Date.parse(lastKnown?.updated_at ?? "") || 0;
  let latest = null;
  const reads = sources.map(async ({ primary, load }) => {
    const metadata = validateConnectionMetadata(await load());
    const updated = Date.parse(metadata?.updated_at ?? "");
    if (!metadata || updated < minimum ||
        (updated === minimum && metadata.server_url !== lastKnown?.server_url)) {
      throw new Error("invalid-or-stale-connection");
    }
    if (!latest || updated > Date.parse(latest.updated_at)) latest = metadata;
    return primary;
  });

  let firstIsPrimary;
  try {
    firstIsPrimary = await Promise.any(reads);
  } catch {
    throw new Error("connection-unavailable");
  }
  // Pages can lag behind the current branch. Wait for a primary when Pages responds first.
  const waitFor = firstIsPrimary ? Promise.allSettled(reads) :
    Promise.any(reads.slice(0, 2)).catch(() => {});
  let timer;
  try {
    await Promise.race([waitFor, new Promise(resolve => {
      timer = setTimeout(resolve, firstIsPrimary ? 200 : 1250);
    })]);
  } finally {
    clearTimeout(timer);
  }
  return latest;
}

if (typeof document !== "undefined") {
  const play = document.querySelector("#play");
  const status = document.querySelector("#status");
  const retry = document.querySelector("#retry");
  const register = document.querySelector("#register");
  const address = document.querySelector("#address");
  const copy = document.querySelector("#copy");
  let currentServerHost = null;
  let lastKnown = null;
  try {
    lastKnown = validateConnectionMetadata(JSON.parse(sessionStorage.getItem(CONNECTION_KEY)));
  } catch { /* The browser can deny access to session storage. */ }
  let loading = null;
  let lastChecked = 0;

  function showLoading() {
    currentServerHost = null;
    play.removeAttribute("href");
    play.setAttribute("aria-disabled", "true");
    register.removeAttribute("href");
    register.setAttribute("aria-disabled", "true");
    address.textContent = "接続先を確認しています…";
    copy.disabled = true;
    status.classList.remove("error", "ready");
    status.textContent = "接続先を確認しています…";
    retry.hidden = true;
  }

  function showUnavailable() {
    address.textContent = "接続先を確認できませんでした";
    status.classList.add("error");
    status.textContent = "接続先を確認できません。少し待ってから更新してください。";
    retry.hidden = false;
  }

  function loadConnection(force = false) {
    if (loading || (!force && currentServerHost && Date.now() - lastChecked < RECHECK_AFTER_MS)) return;
    showLoading();
    loading = fetchConnectionMetadata(lastKnown).then(metadata => {
      lastKnown = metadata;
      try { sessionStorage.setItem(CONNECTION_KEY, JSON.stringify(metadata)); } catch { /* Optional. */ }
      lastChecked = Date.now();
      // Minecraft's address field needs a hostname; its port is passed separately.
      currentServerHost = new URL(metadata.server_url).hostname;
      play.href = buildConnectUri(currentServerHost);
      play.setAttribute("aria-disabled", "false");
      register.href = buildAddServerUri(currentServerHost);
      register.setAttribute("aria-disabled", "false");
      address.textContent = currentServerHost;
      copy.disabled = false;
      status.classList.remove("error");
      status.classList.add("ready");
      status.textContent = "接続先を確認しました";
      retry.hidden = true;
    }).catch(showUnavailable).finally(() => { loading = null; });
  }

  play.addEventListener("click", event => {
    if (!currentServerHost || Date.now() - lastChecked >= RECHECK_AFTER_MS) {
      event.preventDefault();
      loadConnection(true);
      return;
    }
    status.textContent = "Minecraftを開いています…";
    window.setTimeout(() => {
      if (document.visibilityState === "visible" && currentServerHost) {
        status.textContent = "Minecraftが開かないときは、下のヘルプを確認してください。";
        retry.hidden = false;
      }
    }, 1800);
  });

  retry.addEventListener("click", () => loadConnection(true));

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
      status.textContent = "サーバーアドレスをコピーしました";
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(address);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = "選択されたアドレスを長押ししてコピーしてください。";
    }
  });

  loadConnection();
}
