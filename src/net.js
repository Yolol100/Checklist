import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home"];

const IPV4_BLOCKLIST = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3]
]) IPV4_BLOCKLIST.addSubnet(network, prefix, "ipv4");

const IPV6_BLOCKLIST = new net.BlockList();
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["100:0:0:1::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28],
  ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7],
  ["fe00::", 8], ["ff00::", 8]
]) IPV6_BLOCKLIST.addSubnet(network, prefix, "ipv6");

export function isPrivateIp(address) {
  const clean = String(address).toLowerCase().split("%")[0];
  const version = net.isIP(clean);
  if (version === 4) return IPV4_BLOCKLIST.check(clean, "ipv4");
  if (version === 6) return IPV6_BLOCKLIST.check(clean, "ipv6");
  return true;
}

export function isBlockedHostnameLiteral(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host === "0.0.0.0") return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}

function assertDefaultPort(url) {
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const allowed = (url.protocol === "http:" && port === "80") || (url.protocol === "https:" && port === "443");
  if (!allowed) throw new Error("Alleen de standaard publieke webpoorten 80 (HTTP) en 443 (HTTPS) zijn toegestaan.");
}

export async function resolvePublicHost(hostname, lookup = dns.lookup) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isBlockedHostnameLiteral(host)) throw new Error("Lokale, private of gereserveerde targets zijn niet toegestaan.");
  const version = net.isIP(host);
  if (version) return [{ address: host, family: version }];

  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("Hostnaam kon niet publiek worden opgelost.");
  if (addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("Hostnaam verwijst naar een lokaal, privaat of gereserveerd IP-adres.");
  }
  return [...addresses].sort((a, b) => a.family - b.family);
}

export async function assertPublicUrl(rawUrl, { allowQuery = true } = {}) {
  const url = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Alleen http- en https-URL's zijn toegestaan.");
  if (url.username || url.password) throw new Error("URL's met gebruikersnaam of wachtwoord zijn niet toegestaan.");
  if (!allowQuery && url.search) throw new Error("Gebruik een publieke URL zonder queryparameters; requests worden in deze publieke repository opgeslagen.");
  assertDefaultPort(url);
  await resolvePublicHost(url.hostname);
  url.hash = "";
  return url;
}

function responseHeaders(incoming) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.append(key, String(value));
  }
  return headers;
}

async function requestPinned(url, addresses, { timeoutMs, method = "GET", headers = {} }) {
  let lastError;
  for (const { address, family } of addresses) {
    try {
      return await new Promise((resolve, reject) => {
        const client = url.protocol === "https:" ? https : http;
        const requestHeaders = { ...headers, host: url.host };
        const request = client.request({
          host: address,
          family,
          port: url.protocol === "https:" ? 443 : 80,
          method,
          path: `${url.pathname}${url.search}`,
          headers: requestHeaders,
          servername: url.protocol === "https:" ? url.hostname : undefined,
          rejectUnauthorized: true,
          agent: false
        }, (incoming) => {
          const hasNoBody = method === "HEAD" || [204, 205, 304].includes(incoming.statusCode || 0);
          const body = hasNoBody ? null : Readable.toWeb(incoming);
          if (hasNoBody) incoming.resume();
          resolve(new Response(body, {
            status: incoming.statusCode || 500,
            statusText: incoming.statusMessage || "",
            headers: responseHeaders(incoming)
          }));
        });
        request.setTimeout(timeoutMs, () => request.destroy(new Error(`Request timeout na ${timeoutMs}ms.`)));
        request.once("error", reject);
        request.end();
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Geen gevalideerd publiek IP-adres kon worden bereikt.");
}

export async function safeFetch(rawUrl, options = {}) {
  const {
    maxRedirects = 5,
    timeoutMs = 15000,
    allowQuery = true,
    method = "GET",
    headers = {}
  } = options;

  let current = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(rawUrl);
  const redirectChain = [];

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (!/^https?:$/.test(current.protocol)) throw new Error("Alleen http- en https-URL's zijn toegestaan.");
    if (current.username || current.password) throw new Error("URL's met gebruikersnaam of wachtwoord zijn niet toegestaan.");
    if (!allowQuery && current.search) throw new Error("Gebruik een publieke URL zonder queryparameters; requests worden in deze publieke repository opgeslagen.");
    assertDefaultPort(current);
    current.hash = "";
    const addresses = await resolvePublicHost(current.hostname);
    const response = await requestPinned(current, addresses, { timeoutMs, method, headers });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current.href, redirectChain };
      if (redirectCount === maxRedirects) throw new Error("Te veel redirects.");
      const next = new URL(location, current);
      if (!/^https?:$/.test(next.protocol)) throw new Error("Alleen http- en https-URL's zijn toegestaan.");
      if (next.username || next.password) throw new Error("URL's met gebruikersnaam of wachtwoord zijn niet toegestaan.");
      if (!allowQuery && next.search) throw new Error("Gebruik een publieke URL zonder queryparameters; requests worden in deze publieke repository opgeslagen.");
      assertDefaultPort(next);
      await resolvePublicHost(next.hostname);
      next.hash = "";
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
