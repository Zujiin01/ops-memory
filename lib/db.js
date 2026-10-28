// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// SQLite storage (node:sqlite, no native build) with FTS5 full-text search.
const { DatabaseSync } = require("node:sqlite");

const CATEGORIES = ["rule", "instruction", "lesson", "incident", "feedback", "feature", "snapshot", "template"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["draft", "validated", "obsolete"];
// Text fields an agent can fill. Everything is plain text.
const TEXT_FIELDS = ["title", "project", "error_signature", "description", "root_cause", "diagnosis_steps", "quick_fix", "root_fix", "tags"];
const SEARCH_COLS = ["title", "error_signature", "tags", "description", "root_cause", "quick_fix", "root_fix"];

function open(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'lesson',
      project TEXT NOT NULL DEFAULT '',
      error_signature TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      root_cause TEXT NOT NULL DEFAULT '',
      diagnosis_steps TEXT NOT NULL DEFAULT '',
      quick_fix TEXT NOT NULL DEFAULT '',
      root_fix TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'medium',
      tags TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      validated INTEGER NOT NULL DEFAULT 0,
      occurrences INTEGER NOT NULL DEFAULT 1,
      author TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_category ON patterns(category);
    CREATE INDEX IF NOT EXISTS idx_patterns_updated ON patterns(updated_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS patterns_fts USING fts5(
      ${SEARCH_COLS.join(", ")}, content='patterns', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS patterns_ai AFTER INSERT ON patterns BEGIN
      INSERT INTO patterns_fts(rowid, ${SEARCH_COLS.join(", ")}) VALUES (new.id, ${SEARCH_COLS.map((c) => "new." + c).join(", ")});
    END;
    CREATE TRIGGER IF NOT EXISTS patterns_ad AFTER DELETE ON patterns BEGIN
      INSERT INTO patterns_fts(patterns_fts, rowid, ${SEARCH_COLS.join(", ")}) VALUES ('delete', old.id, ${SEARCH_COLS.map((c) => "old." + c).join(", ")});
    END;
    CREATE TRIGGER IF NOT EXISTS patterns_au AFTER UPDATE ON patterns BEGIN
      INSERT INTO patterns_fts(patterns_fts, rowid, ${SEARCH_COLS.join(", ")}) VALUES ('delete', old.id, ${SEARCH_COLS.map((c) => "old." + c).join(", ")});
      INSERT INTO patterns_fts(rowid, ${SEARCH_COLS.join(", ")}) VALUES (new.id, ${SEARCH_COLS.map((c) => "new." + c).join(", ")});
    END;
  `);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('patterns') WHERE name = 'updated_by'").get()) db.exec("ALTER TABLE patterns ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''");
  if (!db.prepare("SELECT 1 FROM pragma_table_info('patterns') WHERE name = 'rev'").get()) db.exec("ALTER TABLE patterns ADD COLUMN rev INTEGER NOT NULL DEFAULT 1");
  return db;
}

// Turns free text into a safe FTS5 query: words only, prefix match. mode "and" is strict, "or" is the fallback.
function ftsQuery(text, mode) {
  const words = (String(text).toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) || []).slice(0, 12);
  if (!words.length) return null;
  return words.map((w) => '"' + w + '"*').join(mode === "or" ? " OR " : " AND ");
}

const ROW_COLS = "id, title, category, project, error_signature, description, root_cause, diagnosis_steps, quick_fix, root_fix, severity, tags, status, validated, occurrences, author, updated_by, rev, created_at, updated_at, last_seen_at";
// Short form used in lists: enough to decide whether to read the full pattern.
const LIST_COLS = "id, title, category, project, error_signature, severity, status, validated, occurrences, author, updated_at";

function search(db, q, { limit = 10, category, project, includeObsolete = false, strict = false } = {}) {
  const run = (mode) => {
    const fq = ftsQuery(q, mode);
    if (!fq) return [];
    const where = ["patterns_fts MATCH ?"], args = [fq];
    if (category) { where.push("p.category = ?"); args.push(category); }
    if (project) { where.push("p.project = ?"); args.push(project); }
    if (!includeObsolete) where.push("p.status != 'obsolete'");
    args.push(limit);
    // bm25: lower is better. Title and error signature weigh more; validated patterns get a bonus.
    return db.prepare(`
      SELECT ${LIST_COLS.split(", ").map((c) => "p." + c).join(", ")},
             substr(p.description, 1, 240) AS excerpt,
             (bm25(patterns_fts, 10.0, 8.0, 6.0, 2.0, 2.0, 1.5, 1.5) - 2.0 * p.validated) AS score
      FROM patterns_fts JOIN patterns p ON p.id = patterns_fts.rowid
      WHERE ${where.join(" AND ")} ORDER BY score LIMIT ?`).all(...args);
  };
  let rows = run("and");
  if (!rows.length && !strict) rows = run("or");
  return rows;
}

module.exports = { open, search, CATEGORIES, SEVERITIES, STATUSES, TEXT_FIELDS, ROW_COLS, LIST_COLS };
