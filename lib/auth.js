// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// API keys: "mem_<32 chars>". Only the SHA-256 hash is stored. The plain key is shown once, at creation.
// Scopes: read (search, read), write (create, enrich), admin (validate, mark obsolete).
const crypto = require("crypto");
const fs = require("fs");

const SCOPES = ["read", "write", "admin"];
const hash = (k) => crypto.createHash("sha256").update(k).digest("hex");
const newKey = () => "mem_" + crypto.randomBytes(24).toString("base64url").slice(0, 32);

function loadKeys(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { keys: [] }; }
}
// Keys belong to root and are readable (not writable) by the service's group.
function saveKeys(file, data, group) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o640 });
  if (group && process.getuid && process.getuid() === 0) {
    const out = require("child_process").execFileSync("getent", ["group", group]).toString().trim().split(":");
    fs.chownSync(file, 0, parseInt(out[2], 10));
    fs.chmodSync(file, 0o640);
  }
}

let logFn = () => {};
const setLog = (fn) => { logFn = fn; };
// X-Real-IP is trusted only when the request comes from the local proxy (nginx), never from a direct client.
const LOCAL = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const ipOf = (req) => (LOCAL.has(req.socket.remoteAddress) && req.get("x-real-ip")) || req.socket.remoteAddress || req.ip;

const fails = new Map();
const tooManyFails = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < 60000).length >= 30;
const noteFail = (ip) => fails.set(ip, [...(fails.get(ip) || []).filter((t) => Date.now() - t < 60000), Date.now()]);

function authMiddleware(keysFile) {
  return (req, res, next) => {
    const ip = ipOf(req);
    if (tooManyFails(ip)) { logFn({ action: "auth", status: "throttled", ip }); return res.status(429).json({ error: "Too many failures, try again in a minute" }); }
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    const row = m && loadKeys(keysFile).keys.find((k) => k.hash === hash(m[1].trim()) && !k.revoked);
    if (!row) {
      noteFail(ip);
      logFn({ action: "auth", status: "refused", error: m ? "invalid or revoked key" : "missing key", route: req.path, ip });
      return res.status(401).json({ error: m ? "Invalid or revoked key" : "Key required (Authorization: Bearer <key>)" });
    }
    req.key = { id: row.id, name: row.name, scopes: row.scopes };
    next();
  };
}

// write does not include admin, admin includes write and read.
const need = (scope) => (req, res, next) => {
  const s = req.key.scopes;
  const ok = s.includes(scope) || s.includes("admin") || (scope === "read" && s.includes("write"));
  if (ok) return next();
  logFn({ key: req.key.id, action: "scope", status: "refused", error: "scope required: " + scope, route: req.path, ip: ipOf(req) });
  return res.status(403).json({ error: "Scope required: " + scope });
};

function rateLimit(perMinute) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.key.id) || []).filter((t) => now - t < 60000);
    if (arr.length >= perMinute) { logFn({ key: req.key.id, action: "rate", status: "refused", ip: ipOf(req) }); return res.status(429).json({ error: "Too many requests (limit " + perMinute + "/min)" }); }
    arr.push(now);
    hits.set(req.key.id, arr);
    next();
  };
}

module.exports = { ipOf, SCOPES, hash, newKey, loadKeys, saveKeys, authMiddleware, need, rateLimit, setLog };
