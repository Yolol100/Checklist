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

const level = ["quick", "standard", "full"].includes(request.level) ? request.level : "standard";
const result = await runChecklist(request.url, level);

const payload = {
  request: {
    url: request.url,
    level,
    requested_at: request.requested_at || null,
    requested_by: request.requested_by || "ChatGPT"
  },
  ...result
};

await fs.mkdir(resultDir, { recursive: true });
await fs.writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Checklist completed for ${result.final_url}`);
console.log(`Decision: ${result.decision}`);
