---
name: memory-first
description: Mandatory protocol before any action on the owner's systems. Search the OPS Memory pattern store first, follow a matching pattern exactly, and write or enrich a pattern after the task.
---

# Memory first

Apply patterns 1, 2 and 3 of the OPS Memory store.

The store's address and your key are in your project instructions (the OPS Memory section). If you do not have them, ask the owner. Never write the key in this skill, in a pattern or in a reply.

Fetch the three patterns now, do not rely on a copy:

- `GET <BASE_URL>/api/v1/memory/1`
- `GET <BASE_URL>/api/v1/memory/2`
- `GET <BASE_URL>/api/v1/memory/3`

Send the header `Authorization: Bearer <KEY>` on every call.

In short: search before acting, follow what you find, write after the task. The patterns are the source of truth. If they change, you change with them.
