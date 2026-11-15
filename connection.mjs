export const SERVER_PORT = 443;
export const SERVER_NAME = "AIの世界";

const GITHUB_API = "https://api.github.com/repos/feel7jp/minecraft-ai-world/contents/connection.json";
const RAW_GITHUB = "https://raw.githubusercontent.com/feel7jp/minecraft-ai-world/main/connection.json";

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

export function buildConnectUri(serverUrl) {
  return `minecraft://connect?serverUrl=${encodeURIComponent(serverUrl)}&serverPort=${SERVER_PORT}`;
}

export function buildAddServerUri(serverUrl) {
  const server = `${SERVER_NAME}|${serverUrl}:${SERVER_PORT}`;
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

export async function fetchConnectionMetadata() {
  const now = Date.now();
  const sources = [
    () => fetchJson(`${GITHUB_API}?_=${now}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
    }),
    () => fetchJson(`./connection.json?_=${now}`),
    () => fetchJson(`${RAW_GITHUB}?_=${now}`),
  ];

  for (const load of sources) {
    try {
      const metadata = validateConnectionMetadata(await load());
      if (metadata) return metadata;
    } catch {
      // Try the next public copy; never use a saved or hardcoded tunnel address.
    }
  }
  throw new Error("connection-unavailable");
}

if (typeof document !== "undefined") {
  const play = document.querySelector("#play");
  const playLabel = document.querySelector("#play-label");
  const status = document.querySelector("#status");
  const retry = document.querySelector("#retry");
  const register = document.querySelector("#register");
  const address = document.querySelector("#address");
  const copy = document.querySelector("#copy");
  let currentServerUrl = null;

  function showLoading() {
    play.disabled = true;
    playLabel.textContent = "世界をさがしているよ…";
    status.classList.remove("error");
    status.textContent = "接続先を見つけているよ…";
    retry.hidden = true;
  }

  function showUnavailable() {
    currentServerUrl = null;
    play.disabled = true;
    playLabel.textContent = "いまは見つからないみたい";
    register.href = "#";
    register.setAttribute("aria-disabled", "true");
    address.textContent = "接続先を見つけられなかったよ";
    copy.disabled = true;
    status.classList.add("error");
    status.textContent = "少し時間をおいて、もう一度ためしてね。";
    retry.hidden = false;
  }

  async function loadConnection() {
    showLoading();
    try {
      const metadata = await fetchConnectionMetadata();
      currentServerUrl = metadata.server_url;
      play.disabled = false;
      playLabel.textContent = "あそぶ！";
      register.href = buildAddServerUri(currentServerUrl);
      register.setAttribute("aria-disabled", "false");
      address.textContent = currentServerUrl;
      copy.disabled = false;
      status.classList.remove("error");
      status.textContent = "接続先を見つけたよ";
      retry.hidden = true;
    } catch {
      showUnavailable();
    }
  }

  play.addEventListener("click", () => {
    if (!currentServerUrl) return;
    window.location.href = buildConnectUri(currentServerUrl);
  });

  retry.addEventListener("click", loadConnection);

  copy.addEventListener("click", async () => {
    if (!currentServerUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(currentServerUrl);
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
