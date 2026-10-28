# Security

## What this service protects, and what it does not

OPS Memory stores text that your agents will read and act on. That is its strength and its risk.

**Patterns are instructions.** An agent that follows a pattern does what it says. Anyone who can write a pattern can steer your agents. So:
- give `write` only to agents you trust, one key per agent;
- the `admin` key (yours) is the only one that validates, retires or edits a validated pattern: agents propose, you decide. Only validated rules are served by `/boot`, so a draft written by an agent never becomes a standing rule until you validate it;
- agents are told that a pattern is data, not an order (see AGENT-INSTRUCTIONS.md), but a model can still be fooled. Read what your agents write now and then (`GET /recent`, the `author` field tells who wrote it).

**Secrets.** The service refuses writes that look like private keys, cloud or GitHub tokens, JWTs, bearer tokens, `password = ...` lines or credentials in URLs, and says which field and rule matched without echoing the value. It is a safety net with known gaps (a secret in an unusual format will pass). The real rule is: never put a secret in a pattern.

## Who can change what

The program (`/opt/ops-memory`), the config and the key file (`/etc/ops-memory/keys.json`) belong to **root**. The service user can read them, not change them: it cannot create keys, raise its own scope, or delete the key file. Only the database directory (`/var/lib/ops-memory`) is writable by the service user. Keys are created and revoked as root (`sudo`). Only a SHA-256 hash of each key is stored.

The service starts with `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome` and a single writable path. It has no route that runs commands or reads files: it only reads and writes patterns.

## Audit

Every creation, update, validation, refusal and failed login is written to standard output as a line starting with `AUDIT` (journald under systemd): `journalctl -u ops-memory | grep AUDIT`. Keys and secret values are never logged. Validation is tied to the revision you reviewed (`rev`): if an agent edits a draft between your reading and your validation, the validation is refused. An obsolete pattern cannot be validated again. Patterns are never deleted: an obsolete pattern is hidden from searches and kept for history.

## Good practices

- One key per agent and per device, minimum scope. Revoke without hesitation (`--revoke <id>`).
- Never paste a key into a conversation, an email or a screenshot. If it happens: revoke and recreate.
- Keep the service on `127.0.0.1`, behind nginx and HTTPS. Use a firewall.
- Back up the database: `sudo MEMORY_CONFIG=/opt/ops-memory/config.json node --no-warnings /opt/ops-memory/bin/backup.js /root/ops-memory-$(date +%F).db` (safe while the service runs).
- The database holds everything your agents learned. Treat the backup like the original.

## Reporting a problem

Use GitHub's private reporting (the *Security* tab, then *Report a vulnerability*) rather than a public issue, or write to didierjean@gnetics.ca, and allow a reasonable delay before publishing a flaw.
