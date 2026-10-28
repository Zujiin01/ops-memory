// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const { ipOf, authMiddleware, need, rateLimit, setLog } = require("./lib/auth");
const { open, search, STATUSES, CATEGORIES, SEVERITIES, TEXT_FIELDS, ROW_COLS, LIST_COLS } = require("./lib/db");
const { findSecret } = require("./lib/secrets");

const cfg = JSON.parse(fs.readFileSync(process.env.MEMORY_CONFIG || path.join(__dirname, "config.json"), "utf8"));
const db = open(cfg.dbFile);
const MAX_FIELD = 8000;

// Audit: one JSON line on standard output (journald under systemd) for writes and refusals.
const log = (entry) => process.stdout.write("AUDIT " + JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
setLog(log);
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.get("/api/v1/health", (req, res) => res.json({ ok: true, service: "ops-memory" }));

const api = express.Router();
api.use(authMiddleware(cfg.keysFile), rateLimit(cfg.rateLimitPerMinute || 120));

const fail = (code, msg, extra) => Object.assign(new Error(msg), { httpCode: code, extra });
const h = (fn) => (req, res) => {
  try { res.json(fn(req)); } catch (e) {
    const code = e.httpCode || 400;
    log({ key: req.key.id, action: req.method + " " + req.path, status: "error", error: e.message, ip: ipOf(req) });
    res.status(code).json({ error: e.message, ...(e.extra || {}) });
  }
};
const lim = (v, d, max) => Math.min(Math.max(parseInt(v, 10) || d, 1), max);
const getRow = (id) => db.prepare(`SELECT ${ROW_COLS} FROM patterns WHERE id = ?`).get(id);
const mustGet = (req) => {
  if (!/^\d+$/.test(req.params.id)) throw fail(400, "Pattern id must be a number");
  const row = getRow(+req.params.id);
  if (!row) throw fail(404, "Pattern not found");
  return row;
};

// Check a body: text fields only strings within limits, enums valid, no secret inside.
function clean(body, { creating }) {
  const out = {};
  for (const f of TEXT_FIELDS) {
    if (body[f] === undefined) continue;
    if (typeof body[f] !== "string") throw fail(400, f + " must be text");
    if (body[f].length > MAX_FIELD) throw fail(400, f + " is too long (" + MAX_FIELD + " characters max)");
    out[f] = body[f];
  }
  if (body.category !== undefined) { if (!CATEGORIES.includes(body.category)) throw fail(400, "category must be one of: " + CATEGORIES.join(", ")); out.category = body.category; }
  if (body.severity !== undefined) { if (!SEVERITIES.includes(body.severity)) throw fail(400, "severity must be one of: " + SEVERITIES.join(", ")); out.severity = body.severity; }
  if (creating && !(out.title || "").trim()) throw fail(400, "title is required (send a JSON body with the header Content-Type: application/json)");
  if (out.title && out.title.length > 200) throw fail(400, "title is too long (200 characters max)");
  return out;
}
function refuseSecrets(obj) {
  const hit = findSecret(obj);
  if (hit) throw fail(422, "Refused: the field '" + hit.field + "' looks like it contains a secret (" + hit.rule + "). Never store keys, passwords or tokens in a pattern. Describe where the secret lives instead.", { refused: true, field: hit.field });
}

// At session start: the rules to apply (full text) and the most recent patterns (short form).
api.get("/boot", need("read"), h((req) => ({
  rules: db.prepare(`SELECT ${ROW_COLS} FROM patterns WHERE category IN ('rule', 'instruction') AND status = 'validated' ORDER BY id LIMIT 50`).all(),
  recent: db.prepare(`SELECT ${LIST_COLS} FROM patterns WHERE status != 'obsolete' ORDER BY updated_at DESC, id DESC LIMIT ?`).all(lim(req.query.limit, 15, 50)),
})));

api.get("/recent", need("read"), h((req) => {
  const where = ["status != 'obsolete'"], args = [];
  if (req.query.category) { where.push("category = ?"); args.push(String(req.query.category)); }
  if (req.query.project) { where.push("project = ?"); args.push(String(req.query.project)); }
  if (req.query.status) {
    if (!STATUSES.includes(String(req.query.status))) throw fail(400, "status must be one of: " + STATUSES.join(", "));
    where.shift(); where.push("status = ?"); args.push(String(req.query.status)); // asking for a status overrides the default "not obsolete"
  }
  args.push(lim(req.query.limit, 20, 100));
  const rows = db.prepare(`SELECT ${LIST_COLS} FROM patterns WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...args);
  return { count: rows.length, patterns: rows };
}));

api.get("/search", need("read"), h((req) => {
  const q = String(req.query.q || "").trim();
  if (!q) throw fail(400, "q is required (1 to 3 short keywords work best)");
  const rows = search(db, q, { limit: lim(req.query.limit, 10, 50), category: req.query.category && String(req.query.category), project: req.query.project && String(req.query.project), includeObsolete: req.query.include_obsolete === "1" });
  return { query: q, count: rows.length, patterns: rows };
}));

api.get("/:id", need("read"), h((req) => mustGet(req)));

api.post("/", need("write"), h((req) => {
  const f = clean(req.body || {}, { creating: true });
  refuseSecrets(f);
  const t = now();
  const info = db.prepare(`INSERT INTO patterns (title, category, project, error_signature, description, root_cause, diagnosis_steps, quick_fix, root_fix, severity, tags, author, updated_by, created_at, updated_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    f.title.trim(), f.category || "lesson", f.project || "", f.error_signature || "", f.description || "", f.root_cause || "", f.diagnosis_steps || "",
    f.quick_fix || "", f.root_fix || "", f.severity || "medium", f.tags || "", req.key.name, req.key.name, t, t, t);
  const id = Number(info.lastInsertRowid);
  // Help the agent keep one pattern per subject: show what already looks similar.
  const seen = new Map();
  for (const q of [f.error_signature, f.title]) {
    if (q && q.trim()) for (const r of search(db, q, { limit: 4, strict: true })) if (r.id !== id && !seen.has(r.id)) seen.set(r.id, { id: r.id, title: r.title, status: r.status });
  }
  const similar = [...seen.values()].slice(0, 3);
  log({ key: req.key.id, action: "create", target: id, ip: ipOf(req) });
  return { id, similar, note: similar.length ? "Similar patterns exist: if one covers the same subject, enrich it (PATCH) instead of keeping a duplicate." : undefined };
}));

// Enrich: replace fields, or append text with a date stamp (body.append = { field: "text" }).
api.patch("/:id", need("write"), h((req) => {
  const row = mustGet(req);
  const body = req.body || {};
  for (const k of ["status", "validated", "author", "occurrences", "id", "created_at", "updated_at", "last_seen_at"]) {
    if (k in body) throw fail(403, "Field '" + k + "' cannot be set through PATCH. Validation and retirement need an admin key: propose it to the owner.");
  }
  if (row.status !== "draft" && !req.key.scopes.includes("admin")) throw fail(403, "This pattern is " + row.status + ": only the owner's admin key can change it. Create a new pattern or propose the change to the owner.");
  const f = clean(body, { creating: false });
  const appendObj = body.append && typeof body.append === "object" ? body.append : {};
  const set = { ...f };
  for (const [k, v] of Object.entries(appendObj)) {
    if (!TEXT_FIELDS.includes(k) || k === "title") throw fail(400, "cannot append to: " + k);
    if (typeof v !== "string") throw fail(400, "append." + k + " must be text");
    const base = k in set ? set[k] : row[k];
    const next = (base ? base + "\n\n" : "") + "[" + now().slice(0, 10) + " " + req.key.name + "] " + v;
    if (next.length > MAX_FIELD) throw fail(400, k + " is full (" + MAX_FIELD + " characters): summarise it with a replacement, or open a new pattern.");
    set[k] = next;
  }
  if (!Object.keys(set).length) throw fail(400, "nothing to update");
  refuseSecrets(set);
  const cols = Object.keys(set);
  db.prepare(`UPDATE patterns SET ${cols.map((c) => c + " = ?").join(", ")}, updated_by = ?, rev = rev + 1, updated_at = ? WHERE id = ?`).run(...cols.map((c) => set[c]), req.key.name, now(), row.id);
  log({ key: req.key.id, action: "update", target: row.id, fields: cols, ip: ipOf(req) });
  return { id: row.id, updated: cols };
}));

// The problem happened again: count it, note when, optionally say what was different.
api.post("/:id/occurrence", need("write"), h((req) => {
  const row = mustGet(req);
  let note = typeof (req.body || {}).note === "string" ? req.body.note : "";
  if (note.length > 1000) throw fail(400, "note is too long (1000 characters max)");
  const locked = row.status !== "draft" && !req.key.scopes.includes("admin");
  if (locked) note = ""; // a validated or obsolete pattern only gets its counter moved, never new text
  if (note) refuseSecrets({ note });
  if (note) {
    const desc = (row.description ? row.description + "\n\n" : "") + "[" + now().slice(0, 10) + " " + req.key.name + " again] " + note;
    if (desc.length > MAX_FIELD) throw fail(400, "description is full (" + MAX_FIELD + " characters): summarise it with a replacement, or open a new pattern.");
    db.prepare("UPDATE patterns SET occurrences = occurrences + 1, last_seen_at = ?, updated_at = ?, updated_by = ?, rev = rev + 1, description = ? WHERE id = ?").run(now(), now(), req.key.name, desc, row.id);
  } else {
    // counter only: no change of text, of rev or of updated_at
    db.prepare("UPDATE patterns SET occurrences = occurrences + 1, last_seen_at = ? WHERE id = ?").run(now(), row.id);
  }
  log({ key: req.key.id, action: "occurrence", target: row.id, ip: ipOf(req) });
  return { id: row.id, occurrences: row.occurrences + 1, note_ignored: locked && !!(req.body || {}).note || undefined };
}));

// Only an admin key (you) marks a pattern as validated or obsolete: agents propose, you decide.
// Validation is tied to the exact version you reviewed: send the "rev" you read. If an agent edited the draft since, it is refused.
api.post("/:id/validate", need("admin"), h((req) => {
  const row = mustGet(req);
  if (row.status !== "draft") throw fail(409, "Only a draft can be validated (this one is " + row.status + "). An obsolete pattern stays obsolete: create a new one.");
  const rev = (req.body || {}).rev;
  if (!Number.isInteger(rev)) throw fail(400, "Send the revision you reviewed: {\"rev\": " + row.rev + "} (read it with GET /<id>).");
  if (rev !== row.rev) throw fail(409, "The pattern changed since you read it (now revision " + row.rev + ", you sent " + rev + "). Read it again before validating.");
  db.prepare("UPDATE patterns SET validated = 1, status = 'validated', updated_by = ?, rev = rev + 1, updated_at = ? WHERE id = ?").run(req.key.name, now(), row.id);
  log({ key: req.key.id, action: "validate", target: row.id, rev, ip: ipOf(req) });
  return { id: row.id, status: "validated" };
}));
api.post("/:id/obsolete", need("admin"), h((req) => {
  const row = mustGet(req);
  const reason = typeof (req.body || {}).reason === "string" ? req.body.reason : "";
  if (reason.length > 1000) throw fail(400, "reason is too long (1000 characters max)");
  if (reason) refuseSecrets({ reason });
  const desc = reason ? (row.description ? row.description + "\n\n" : "") + "[" + now().slice(0, 10) + " obsolete] " + reason : row.description;
  if (desc.length > MAX_FIELD) throw fail(400, "description is full: shorten the reason or the pattern.");
  db.prepare("UPDATE patterns SET status = 'obsolete', validated = 0, description = ?, updated_by = ?, rev = rev + 1, updated_at = ? WHERE id = ?").run(desc, req.key.name, now(), row.id);
  log({ key: req.key.id, action: "obsolete", target: row.id, ip: ipOf(req) });
  return { id: row.id, status: "obsolete" };
}));

app.use("/api/v1/memory", api);
app.use((req, res) => res.status(404).json({ error: "Unknown route" }));
app.use((err, req, res, next) => res.status(err.status || 400).json({ error: err.type === "entity.too.large" ? "Body too large" : "Invalid request" }));

if (require.main === module) {
  app.listen(cfg.port, cfg.host || "127.0.0.1", () => console.log("ops-memory listening on " + (cfg.host || "127.0.0.1") + ":" + cfg.port));
}
module.exports = app;
