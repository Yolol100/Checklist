import http from "node:http";
import net from "node:net";
import { resolvePublicHost } from "./net.js";

function parseConnectAuthority(authority) {
  const url = new URL(`https://${authority}/`);
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("CONNECT target must use public HTTPS port 443.");
  }
  return url;
}

async function connectFirstPublic(hostname, port) {
  const addresses = await resolvePublicHost(hostname);
  let lastError;
  for (const { address, family } of addresses) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.connect({ host: address, family, port });
        const timer = setTimeout(() => socket.destroy(new Error("Proxy connect timeout.")), 10_000);
        socket.once("connect", () => {
          clearTimeout(timer);
          resolve(socket);
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No validated public endpoint available.");
}

async function handleHttpProxy(request, response) {
  let target;
  try {
    target = new URL(request.url || "");
    if (target.protocol !== "http:" || (target.port && target.port !== "80")) throw new Error("Only public HTTP port 80 is allowed.");
    const addresses = await resolvePublicHost(target.hostname);
    const { address, family } = addresses[0];
    const headers = { ...request.headers, host: target.host };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];

    const upstream = http.request({
      host: address,
      family,
      port: 80,
      method: request.method,
      path: `${target.pathname}${target.search}`,
      headers,
      agent: false
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.setTimeout(15_000, () => upstream.destroy(new Error("Proxy upstream timeout.")));
    upstream.once("error", (error) => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end(`Blocked or unavailable upstream: ${error.message}`);
    });
    request.pipe(upstream);
  } catch (error) {
    response.writeHead(403, { "content-type": "text/plain" });
    response.end(`Blocked by public-network proxy: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleConnect(request, clientSocket, head) {
  try {
    const target = parseConnectAuthority(request.url || "");
    const serverSocket = await connectFirstPublic(target.hostname, 443);
    clientSocket.write("HTTP/1.1 200 Connection Established\r\nProxy-Agent: Webactueel-Checklist-QA\r\n\r\n");
    if (head?.length) serverSocket.write(head);
    serverSocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => serverSocket.destroy());
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  } catch (error) {
    if (!clientSocket.destroyed) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    }
  }
}

export async function startPublicNetworkProxy() {
  const server = http.createServer((request, response) => {
    void handleHttpProxy(request, response);
  });
  server.on("connect", (request, socket, head) => {
    void handleConnect(request, socket, head);
  });
  server.on("clientError", (_error, socket) => socket.destroy());

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Proxy did not expose a TCP port.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
