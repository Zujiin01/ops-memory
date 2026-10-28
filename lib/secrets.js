// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// A pattern is shared text. It must never contain a key, a password or a token.
// This check refuses what looks like one. It is a safety net, not a guarantee: write patterns without secrets.
const RULES = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["API key (sk-)", /\bsk-[A-Za-z0-9_-]{16,}\b/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+\/=-]{20,}/i],
  ["key of this suite", /\b(door|mem)_[A-Za-z0-9_-]{24,}\b/],
  ["Stripe key", /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ["GitLab or npm token", /\bglpat-[A-Za-z0-9_-]{16,}\b|\bnpm_[A-Za-z0-9]{30,}\b/],
  ["SendGrid key", /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/],
  ["Hugging Face token", /\bhf_[A-Za-z0-9]{30,}\b/],
  ["Telegram bot token", /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ["password option", /--(password|passwd|pass|token|secret)[= ]\s*["']?[^\s"'-][^\s"']{5,}/i],
  ["French password", /\bmot de passe\s*(:|=|est)\s*["']?[^\s"',;]{4,}/i],
  ["AWS temporary key", /\bASIA[0-9A-Z]{16}\b/],
  ["Slack or Discord token", /\bxapp-[A-Za-z0-9-]{10,}|\bhooks\.slack\.com\/services\/[A-Za-z0-9\/]{20,}|\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b|discord(app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/],
  ["PGP private key", /-----BEGIN PGP PRIVATE KEY BLOCK-----/],
  ["basic auth", /\bBasic\s+[A-Za-z0-9+\/]{16,}={0,2}/],
  ["spoken password", /\b(password|passwd|passphrase|mot de passe)\s+(is|est|was|:)\s*["']?[^\s"',;]{6,}/i],
  ["short password label", /(^|[^A-Za-z0-9])([A-Za-z0-9]+[_-])?(pass|pwd|pw)["']?\s*[:=]\s*["']?[^\s"',;]{6,}/i],
  ["labelled secret", /[A-Za-z0-9_-]*(password|passwd|passphrase|secret|api[_-]?key|private[_-]?key|access[_-]?key|token|credential)[A-Za-z0-9_-]*["']?\s*[:=]\s*["']?(?!https?:\/\/)(?!\d+(\s|$|[,;"']))[^\s"',;]{8,}/i],
  ["credentials in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]*:[^\s@\/]{3,}@/i],
];

// Returns null if clean, else { field, rule } (never the value itself).
function findSecret(obj) {
  for (const [field, value] of Object.entries(obj || {})) {
    let text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
    text = text.replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, "").normalize("NFKC"); // hidden characters cannot split a secret
    for (const [rule, re] of RULES) if (re.test(text)) return { field, rule };
  }
  return null;
}

module.exports = { findSecret };
