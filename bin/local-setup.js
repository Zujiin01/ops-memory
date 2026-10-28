#!/usr/bin/env node
// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// Try OPS Memory on your own computer in one command (no server, no root, no nginx).
// Creates ./data, a config.json, loads the 10 starter patterns and makes two keys: an owner (admin) and an agent (read, write).
const fs = require("fs");
const path = require("path");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error("Node 22.13 or newer is required (you have " + process.versions.node + ")."); process.exit(1); }
try { new (require("node:sqlite").DatabaseSync)(":memory:").exec("CREATE VIRTUAL TABLE t USING fts5(a)"); } catch { console.error("This Node build has no SQLite FTS5 support."); process.exit(1); }
const root = path.join(__dirname, "..");
const cfgFile = path.join(root, "config.json");
if (fs.existsSync(cfgFile)) { console.error("refused: config.json already exists (this script only prepares a fresh local trial)"); process.exit(1); }
fs.mkdirSync(path.join(root, "data"), { recursive: true });
const cfg = { host: "127.0.0.1", port: 3500, dbFile: path.join(root, "data", "memory.db"), keysFile: path.join(root, "data", "keys.json"), rateLimitPerMinute: 120 };
fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
process.env.MEMORY_CONFIG = cfgFile;
const { SCOPES, hash, newKey, saveKeys } = require("../lib/auth");
const keys = [];
const make = (name, scopes) => { const key = newKey(); keys.push({ id: "k" + Date.now().toString(36) + name.length, name, scopes, hash: hash(key), created: new Date().toISOString() }); return key; };
const ownerKey = make("owner", ["admin"]);
const agentKey = make("my-agent", ["read", "write"]);
saveKeys(cfg.keysFile, { keys });
require("./import-starter");
console.log(`
Ready. 1) Start the service:  npm start      (keep it running)
       2) In another terminal, try it:

  curl -s -H "Authorization: Bearer ${agentKey}" http://127.0.0.1:3500/api/v1/memory/boot
  curl -s -H "Authorization: Bearer ${agentKey}" "http://127.0.0.1:3500/api/v1/memory/search?q=secret"

Your agent key (read, write):    ${agentKey}
Your owner key (admin):          ${ownerKey}
Keep them: they are not shown again. This is a trial setup, for a real server follow "Going live" in the README.
Port 3500 busy? Change "port" in config.json. Lost the keys? rm -rf config.json data && npm run try`);
