import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function sha256File(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function writeJsonArtifact(rootDir, relativePath, value) {
  const filePath = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return {
    path: relativePath.replaceAll("\\", "/"),
    sha256: await sha256File(filePath)
  };
}

export async function describeArtifact(rootDir, relativePath, type, scope) {
  const filePath = path.join(rootDir, relativePath);
  const stat = await fs.stat(filePath);
  return {
    id: `EV-FILE-${relativePath.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
    type,
    source: relativePath.replaceAll("\\", "/"),
    created_at: stat.mtime.toISOString(),
    environment: "github-actions",
    scope,
    sha256: await sha256File(filePath)
  };
}
