const SAFE_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-type",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy"
]);

const PRESENCE_ONLY_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only"
]);

export function sanitizeUrlForEvidence(value) {
  if (!value) return null;
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(String(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "[invalid-url-redacted]";
  }
}

export function sanitizeEvidenceText(value, maxLength = 500) {
  let text = String(value ?? "");
  text = text.replace(/https?:\/\/[^\s'"<>]+/gi, (match) => sanitizeUrlForEvidence(match) || "[url-redacted]");
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[redacted]");
  text = text.replace(/\b(token|access_token|id_token|api[_-]?key|secret|authorization)=([^\s&]+)/gi, "$1=[redacted]");
  text = text.replace(/\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[jwt-redacted]");
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email-redacted]");
  return text.slice(0, maxLength);
}

export function sanitizeUrlList(values, max = 80) {
  return [...new Set((values || []).map(sanitizeUrlForEvidence).filter(Boolean))].slice(0, max);
}

export function sanitizeResponseHeaders(headers) {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers || {});
  const result = {};
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey).toLowerCase();
    if (SAFE_RESPONSE_HEADERS.has(key)) result[key] = sanitizeEvidenceText(rawValue, 2000);
    else if (PRESENCE_ONLY_HEADERS.has(key)) result[key] = "[present]";
  }
  return result;
}

export function isSafeAutomaticProbeUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(String(value));
    return /^https?:$/.test(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
