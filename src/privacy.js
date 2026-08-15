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
  return text.slice(0, maxLength);
}

export function sanitizeUrlList(values, max = 80) {
  return [...new Set((values || []).map(sanitizeUrlForEvidence).filter(Boolean))].slice(0, max);
}
