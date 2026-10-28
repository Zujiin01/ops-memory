#!/usr/bin/env node
// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// Loads the 10 starter patterns (numbers 1 to 10) into an EMPTY database. Refuses otherwise.
const fs = require("fs");
const path = require("path");
const { open } = require("../lib/db");
const cfg = JSON.parse(fs.readFileSync(process.env.MEMORY_CONFIG || path.join(__dirname, "..", "config.json"), "utf8"));
const db = open(cfg.dbFile);
if (db.prepare("SELECT COUNT(*) AS n FROM patterns").get().n > 0) { console.error("refused: the database is not empty"); process.exit(1); }
const dir = path.join(__dirname, "..", "patterns-start");
const t = new Date().toISOString().replace("T", " ").slice(0, 19);
const ins = db.prepare(`INSERT INTO patterns (id, title, category, project, error_signature, description, root_cause, diagnosis_steps, quick_fix, root_fix, severity, tags, status, validated, author, created_at, updated_at, last_seen_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated', 1, 'starter', ?, ?, ?)`);
db.exec("BEGIN");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  ins.run(p.id, p.title, p.category, p.project || "", p.error_signature || "", p.description, p.root_cause, p.diagnosis_steps, p.quick_fix, p.root_fix, p.severity, p.tags, t, t, t);
}
db.exec("COMMIT");
console.log("starter patterns loaded: " + db.prepare("SELECT COUNT(*) AS n FROM patterns").get().n);
