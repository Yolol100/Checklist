import dns from "node:dns/promises";
import net from "node:net";

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home"];

function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address) {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(value)) return true;
  if (value.startsWith("ff")) return true;
  if (value.startsWith("2001:db8")) return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return net.isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

export function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

export function isBlockedHostnameLiteral(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "0.0.0.0") return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}

export async function assertPublicUrl(rawUrl, { allowQuery = true } = {}) {
  const url = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Alleen http- en https-URL's zijn toegestaan.");
  if (url.username || url.password) throw new Error("URL's met gebruikersnaam of wachtwoord zijn niet toegestaan.");
  if (!allowQuery && url.search) throw new Error("Gebruik een publieke URL zonder queryparameters; requests worden in deze publieke repository opgeslagen.");
  if (isBlockedHostnameLiteral(url.hostname)) throw new Error("Lokale, private of gereserveerde targets zijn niet toegestaan.");

  if (!net.isIP(url.hostname)) {
    const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length) throw new Error("Hostnaam kon niet publiek worden opgelost.");
    if (addresses.some(({ address }) => isPrivateIp(address))) {
      throw new Error("Hostnaam verwijst naar een lokaal, privaat of gereserveerd IP-adres.");
    }
  }

  url.hash = "";
  return url;
}

export async function safeFetch(rawUrl, options = {}) {
  const {
    maxRedirects = 5,
    timeoutMs = 15000,
    allowQuery = true,
    ...fetchOptions
  } = options;

  let current = await assertPublicUrl(rawUrl, { allowQuery });
  const redirectChain = [];

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        ...fetchOptions,
        redirect: "manual",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current.href, redirectChain };
      if (redirectCount === maxRedirects) throw new Error("Te veel redirects.");
      const next = await assertPublicUrl(new URL(location, current), { allowQuery: true });
      redirectChain.push({ from: current.href, status: response.status, to: next.href });
      current = next;
      continue;
    }

    return { response, finalUrl: current.href, redirectChain };
  }

  throw new Error("Redirectlimiet overschreden.");
}

export async function readTextLimited(response, maxBytes = 2_500_000) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error(`Response is groter dan ${maxBytes} bytes.`);
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response is groter dan ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
