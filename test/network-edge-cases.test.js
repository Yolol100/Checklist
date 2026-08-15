import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl,
  isBlockedHostnameLiteral,
  isPrivateIp,
  readTextLimited,
  resolvePublicHost,
  safeFetch
} from "../src/net.js";

const blockedIpv4 = [
  "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
  "172.16.0.1", "192.0.0.1", "192.0.2.1", "192.88.99.2", "192.168.1.1",
  "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255"
];
const allowedIpv4 = ["1.1.1.1", "8.8.8.8"];
const blockedIpv6 = [
  "::", "::1", "::ffff:127.0.0.1", "64:ff9b:1::1", "100::1", "100:0:0:1::1",
  "2001::1", "2001:2::1", "2001:10::1", "2001:db8::1", "2002::1", "3fff::1",
  "5f00::1", "fc00::1", "fd00::1", "fe80::1", "fec0::1", "ff02::1"
];
const allowedIpv6 = ["2606:4700:4700::1111", "2001:4860:4860::8888"];
const publicAddresses = [{ address: "8.8.8.8", family: 4 }];

test("IP classifier blocks IANA special, private, transition, benchmark and documentation ranges", () => {
  for (const address of blockedIpv4) assert.equal(isPrivateIp(address), true, `${address} should be blocked`);
  for (const address of blockedIpv6) assert.equal(isPrivateIp(address), true, `${address} should be blocked`);
});

test("IP classifier keeps well-known global addresses public", () => {
  for (const address of allowedIpv4) assert.equal(isPrivateIp(address), false, `${address} should be public`);
  for (const address of allowedIpv6) assert.equal(isPrivateIp(address), false, `${address} should be public`);
});

test("hostname literals reject local/private conventions including trailing-dot localhost", () => {
  for (const host of ["localhost", "localhost.", "foo.local", "x.localhost", "router.internal", "device.lan", "box.home", "127.0.0.1", "[::1]"]) {
    assert.equal(isBlockedHostnameLiteral(host), true, `${host} should be blocked`);
  }
  assert.equal(isBlockedHostnameLiteral("example.com"), false);
});

test("resolvePublicHost rejects mixed public/private DNS answers", async () => {
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }];
  await assert.rejects(() => resolvePublicHost("rebind.example", lookup), /privaat|gereserveerde/);
});

test("assertPublicUrl rejects credentials, unsafe protocols, non-web ports and query strings when requested", async () => {
  await assert.rejects(() => assertPublicUrl("file:///etc/passwd"), /http- en https/);
  await assert.rejects(() => assertPublicUrl("https://user:pass@8.8.8.8/"), /gebruikersnaam of wachtwoord/);
  await assert.rejects(() => assertPublicUrl("http://8.8.8.8:22/"), /poorten 80.*443/);
  await assert.rejects(() => assertPublicUrl("https://8.8.8.8:8443/"), /poorten 80.*443/);
  await assert.rejects(() => assertPublicUrl("https://8.8.8.8/?secret=1", { allowQuery: false }), /zonder queryparameters/);
  const clean = await assertPublicUrl("https://8.8.8.8/path#fragment", { allowQuery: false });
  assert.equal(clean.href, "https://8.8.8.8/path");
});

test("safeFetch uses the validated resolver result as its actual transport target", async () => {
  let resolverCalls = 0;
  let capturedAddresses;
  const resolver = async () => {
    resolverCalls += 1;
    return [{ address: "8.8.4.4", family: 4 }];
  };
  const requester = async (_url, addresses) => {
    capturedAddresses = addresses;
    return new Response("ok", { status: 200 });
  };
  const result = await safeFetch("https://example.com/", { resolver, requester });
  assert.equal(result.response.status, 200);
  assert.equal(resolverCalls, 1);
  assert.deepEqual(capturedAddresses, [{ address: "8.8.4.4", family: 4 }]);
});

test("safeFetch rejects query URLs by default before transport", async () => {
  let calls = 0;
  const requester = async () => { calls += 1; return new Response("ok"); };
  await assert.rejects(() => safeFetch("https://8.8.8.8/?token=secret", { requester }), /geen URL's met queryparameters/);
  assert.equal(calls, 0);
});

test("safeFetch preserves the no-query rule across redirects", async () => {
  let calls = 0;
  const requester = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "https://8.8.8.8/?token=secret" } });
  };
  await assert.rejects(() => safeFetch("https://8.8.8.8/", { resolver: async () => publicAddresses, requester }), /geen redirects met queryparameters/);
  assert.equal(calls, 1, "redirect target must be rejected before a second request");
});

test("safeFetch rejects redirect targets into private networks before transport", async () => {
  let calls = 0;
  const requester = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } });
  };
  await assert.rejects(() => safeFetch("https://8.8.8.8/", { requester }), /private|gereserveerde|Lokale/i);
  assert.equal(calls, 1);
});

test("safeFetch enforces redirect limits", async () => {
  const requester = async (url) => new Response(null, { status: 302, headers: { location: new URL("/next", url).href } });
  await assert.rejects(() => safeFetch("https://8.8.8.8/", { maxRedirects: 1, requester }), /Te veel redirects/);
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
