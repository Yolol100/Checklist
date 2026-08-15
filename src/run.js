import fs from "node:fs/promises";
import path from "node:path";
import { runChecklist } from "./checklist.js";

const root = process.cwd();
const requestPath = path.join(root, "requests", "current.json");
const resultDir = path.join(root, "results");
const resultPath = path.join(resultDir, "latest.json");

const raw = await fs.readFile(requestPath, "utf8");
const request = JSON.parse(raw);

if (!request.url || typeof request.url !== "string") {
  throw new Error("requests/current.json moet een geldige url bevatten.");
}

const target = new URL(request.url);
if (!/^https?:$/.test(target.protocol)) {
  throw new Error("Alleen publieke http- en https-URL's zijn toegestaan.");
}

const blockedHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
if (blockedHosts.has(target.hostname.toLowerCase()) || target.hostname.endsWith(".local")) {
  throw new Error("Lokale/private targets zijn niet toegestaan.");
}

const level = ["quick", "standard", "full"].includes(request.level) ? request.level : "standard";
const requestId = request.request_id || `manual-${Date.now()}`;
const result = await runChecklist(request.url, level);

const payload = {
  request: {
    request_id: requestId,
    url: request.url,
    level,
    requested_at: request.requested_at || null,
    requested_by: request.requested_by || "ChatGPT"
  },
  ...result
};

await fs.mkdir(resultDir, { recursive: true });
await fs.writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Request: ${requestId}`);
console.log(`Checklist completed for ${result.final_url}`);
console.log(`Decision: ${result.decision}`);
