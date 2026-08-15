import fs from "node:fs/promises";
import { TARGET_ENVIRONMENTS } from "./contracts.js";

const filePath = process.argv[2] || "results/formal-latest.json";
const data = JSON.parse(await fs.readFile(filePath, "utf8"));
const errors = [];
const fail = (condition, message) => { if (!condition) errors.push(message); };

const targetEnvironment = data.scan_configuration?.target_environment;
fail(TARGET_ENVIRONMENTS.has(targetEnvironment), "scan_configuration.target_environment ontbreekt of is ongeldig; legacy raw evidence moet opnieuw worden uitgevoerd");

if (targetEnvironment !== "production") {
  fail(data.evidence_level !== "production_observation", `${targetEnvironment} mag geen production_observation als hoogste evidence_level claimen`);
  fail(data.capabilities?.production_observation === false, `${targetEnvironment} moet capabilities.production_observation=false hebben`);
}
if (data.evidence_level === "production_observation") {
  fail(targetEnvironment === "production", "production_observation vereist target_environment=production");
  fail(data.capabilities?.production_observation === true, "production_observation vereist capability=true");
}

const matrixItems = Array.isArray(data.runtime_matrix?.items) ? data.runtime_matrix.items : [];
const passedBrowser = matrixItems.some((item) => item.status === "passed" && ["browser", "device"].includes(item.category));
fail(Boolean(data.capabilities?.browser_harness) === passedBrowser, "capabilities.browser_harness moet overeenkomen met passed browser/device runtime evidence");
fail(Boolean(data.capabilities?.public_browser) === passedBrowser, "capabilities.public_browser moet overeenkomen met passed browser/device runtime evidence");
fail(Boolean(data.capabilities?.cloud_browser) === passedBrowser, "capabilities.cloud_browser moet overeenkomen met passed browser/device runtime evidence");

if (data.release_decision === "go") {
  const staging = matrixItems.find((item) => item.id === "RT-STAGING");
  fail(staging?.required === true && staging?.status === "passed", "volledige go vereist RT-STAGING als required+passed runtime-item");
  fail(data.capabilities?.staging_access === true, "volledige go vereist staging_access=true");
}

if (errors.length) {
  console.error("Formele hardeningvalidatie mislukt:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Formele hardeningvalidatie geslaagd voor target_environment=${targetEnvironment}.`);
