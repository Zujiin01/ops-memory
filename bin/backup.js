#!/usr/bin/env node
// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// Consistent copy of the database, safe while the service runs.  Usage: node bin/backup.js /path/to/backup.db
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const cfg = JSON.parse(fs.readFileSync(process.env.MEMORY_CONFIG || path.join(__dirname, "..", "config.json"), "utf8"));
const out = process.argv[2];
if (!out) { console.error("usage: node bin/backup.js /path/to/backup.db"); process.exit(1); }
let st = null; try { st = fs.lstatSync(out); } catch {}
if (st) { console.error("refused: " + out + " already exists" + (st.isSymbolicLink() ? " (symbolic link)" : "")); process.exit(1); }
process.umask(0o077);
const db = new DatabaseSync(cfg.dbFile);
db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");
fs.chmodSync(out, 0o600);
console.log("backup written: " + out + " (" + fs.statSync(out).size + " bytes)");
