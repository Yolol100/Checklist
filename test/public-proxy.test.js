import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { startPublicNetworkProxy } from "../src/public-proxy.js";

function parseProxyUrl(value) {
  const url = new URL(value);
  return { host: url.hostname, port: Number(url.port) };
}

async function proxyHttpRequest(proxyUrl, targetUrl) {
  const proxy = parseProxyUrl(proxyUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: proxy.host, port: proxy.port, method: "GET", path: targetUrl }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
}

async function proxyConnect(proxyUrl, authority) {
  const proxy = parseProxyUrl(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxy.port, proxy.host);
    let data = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`));
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(data.split("\r\n", 1)[0]);
      }
    });
    socket.once("error", reject);
  });
}

test("DNS-pinning browser proxy blocks private HTTP targets", async () => {
  const proxy = await startPublicNetworkProxy();
  try {
    assert.equal(await proxyHttpRequest(proxy.url, "http://127.0.0.1/secret"), 403);
  } finally {
    await proxy.close();
  }
});

test("DNS-pinning browser proxy blocks private CONNECT targets and alternate ports", async () => {
  const proxy = await startPublicNetworkProxy();
  try {
    assert.match(await proxyConnect(proxy.url, "127.0.0.1:443"), /403 Forbidden/);
    assert.match(await proxyConnect(proxy.url, "8.8.8.8:8443"), /403 Forbidden/);
  } finally {
    await proxy.close();
  }
});
