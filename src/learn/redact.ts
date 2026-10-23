export const BUILTIN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|bearer)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-/+=.]{16,}/i,
  /Bearer\s+[A-Za-z0-9_\-.=]{24,}/,
  /[?&](access_token|api_key|apikey|token)=[A-Za-z0-9_\-.]{12,}/i,
  /\b[0-9a-f]{64}\b/,
];

export function isSensitive(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
