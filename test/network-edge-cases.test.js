import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl,
  isBlockedHostnameLiteral,
  isPrivateIp,
  readTextLimited,
  safeFetch
} from "../src/net.js";

const blockedIpv4 = [
  "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
  "172.16.0.1", "192.0.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1",
  "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"
];
const allowedIpv4 = ["1.1.1.1", "8.8.8.8"];
const blockedIpv6 = ["::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1"];
const allowedIpv6 = ["2606:4700:4700::1111", "2001:4860:4860::8888"];

test("IP classifier blocks private, link-local, benchmark and documentation ranges", () => {
  for (const address of blockedIpv4) assert.equal(isPrivateIp(address), true, `${address} should be blocked`);
  for (const address of blockedIpv6) assert.equal(isPrivateIp(address), true, `${address} should be blocked`);
});

test("IP classifier keeps well-known global addresses public", () => {
  for (const address of allowedIpv4) assert.equal(isPrivateIp(address), false, `${address} should be public`);
  for (const address of allowedIpv6) assert.equal(isPrivateIp(address), false, `${address} should be public`);
});

test("hostname literals reject local/private conventions", () => {
  for (const host of ["localhost", "foo.local", "x.localhost", "router.internal", "device.lan", "box.home", "127.0.0.1", "[::1]"]) {
    assert.equal(isBlockedHostnameLiteral(host), true, `${host} should be blocked`);
  }
  assert.equal(isBlockedHostnameLiteral("example.com"), false);
});

test("assertPublicUrl rejects credentials, unsafe protocols and query strings when requested", async () => {
  await assert.rejects(() => assertPublicUrl("file:///etc/passwd"), /http- en https/);
  await assert.rejects(() => assertPublicUrl("https://user:pass@8.8.8.8/"), /gebruikersnaam of wachtwoord/);
  await assert.rejects(() => assertPublicUrl("https://8.8.8.8/?secret=1", { allowQuery: false }), /zonder queryparameters/);
  const clean = await assertPublicUrl("https://8.8.8.8/path#fragment", { allowQuery: false });
  assert.equal(clean.href, "https://8.8.8.8/path");
});

test("safeFetch preserves the no-query rule across redirects", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "https://8.8.8.8/?token=secret" } });
  };
  try {
    await assert.rejects(() => safeFetch("https://8.8.8.8/", { allowQuery: false }), /zonder queryparameters/);
    assert.equal(calls, 1, "redirect target must be rejected before a second request");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetch rejects redirect targets into private networks", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  try {
    await assert.rejects(() => safeFetch("https://8.8.8.8/"), /private|gereserveerde|Lokale/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeFetch enforces redirect limits", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(null, { status: 302, headers: { location: new URL("/next", url).href } });
  try {
    await assert.rejects(() => safeFetch("https://8.8.8.8/", { maxRedirects: 1 }), /Te veel redirects/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("readTextLimited rejects declared and streamed oversize responses", async () => {
  await assert.rejects(() => readTextLimited(new Response("x", { headers: { "content-length": "100" } }), 10), /groter dan 10/);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    }
  });
  await assert.rejects(() => readTextLimited(new Response(stream), 10), /groter dan 10/);
});
