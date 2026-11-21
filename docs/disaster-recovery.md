# D1 Availability & Disaster Recovery

**Goal: preserve availability. Never run remote D1 export/restore or migrations as part of a routine test.**

## Current safe backup

Cloudflare D1 Time Travel is automatically enabled on D1's production backend, with
a retention window of **7 days on Free** and **30 days on Paid**. This requires
no scheduled database export and does not block normal Worker requests just
to maintain recovery points.

Use a read-only check of the recovery bookmark **before** an approved migration:

```sh
pnpm exec wrangler d1 time-travel info db-parts
```

Check that the database is using the production storage backend, not legacy
alpha. No automatic restore or mutation is performed by this document.

**Never** run `d1 time-travel restore` during ordinary operations or in CI:
it overwrites the live database and cancels in-flight queries. Recovery requires
manual incident authorization, verified restore point, impact assessment, and
post-recovery integrity and read/write smoke tests.

**Never** schedule `wrangler d1 export --remote` on a busy production service:
Cloudflare states that export blocks other DB requests. A full offline
SQL export for long-term retention, if required, must be separately planned for
a maintenance window / low-traffic period. The JSON export screen is **not**
a complete backup; it omits several application tables and relations.

## Safe, runnable restoration test without production access

A dedicated GitHub Actions job:

1. Creates a new disposable local D1 database with **all SQL migrations**.
2. Inserts a unique sentinel row.
3. Uses Wrangler to export local D1 schema **and all table data** as SQL.
4. Restores that SQL to another fresh, isolated SQLite database.
5. Checks `PRAGMA integrity_check`, `foreign_key_check`, table names,
   column layouts, full row counts and SHA-256 digests of every table's rows.
6. Corrupts the backup and proves that parity verification **fails closed**.

Run in GitHub Actions workflow `backup-restore.yml`. No Cloudflare account
secrets, live database connections, or production mutations are needed.

The verifier itself accepts only a local SQLite source directory and a SQL
backup. It cannot overwrite the original source or any remote D1 database.

## Upgrade notes

PR #8 depends on the draft PR #7, and adds an **additive** migration
`0013_atomic_import_revert_guard.sql`. No existing table is rewritten.
Run migrations only during a deliberate release after a validated recovery
bookmark and reviewed compatibility plan.

Import revert uses one atomic D1 batch, and will **reject** ambiguous
older imports or repeated part IDs (409) rather than risk corrupting inventory.
Category definition updates reject destructive removal/key rename/type
changes when currently used; raw attributes are preserved on bulk category
moves and compatible typed values are regenerated.

This CI backup test is not a proof of the performance or health of a real
remote D1 restore. An incident recovery drill against a separately owned
disposable Cloudflare database would be a later optional operational exercise,
not an automated action against the live service.

References:
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
