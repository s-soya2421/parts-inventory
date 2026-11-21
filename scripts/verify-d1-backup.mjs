#!/usr/bin/env node
/**
 * NON-DESTRUCTIVE full backup round-trip verification for local D1 only.
 *
 * Compares every user table and every row from a read-only live local SQLite
 * database to a completely separate database freshly restored from Wrangler's
 * exported SQL. No remote API, D1 mutation or overwrite is performed.
 *
 * Usage:
 *   node scripts/verify-d1-backup.mjs \
 *      --source-dir .wrangler/state --backup /tmp/d1-test-snapshot.sql \
 *      --sentinel RESTORE-SENTINEL
 */
import { DatabaseSync } from "node:sqlite";
import { argv, stdout } from "node:process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  mkdtempSync, readdirSync, readFileSync, rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function arg(flag) {
  const position = argv.indexOf(flag);
  if (position < 0 || !argv[position + 1]) {
    throw new Error("Missing required " + flag + " argument");
  }
  return argv[position + 1];
}

function findDbFiles(root) {
  const found = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile() && entry.name.endsWith(".sqlite")) found.push(next);
    }
  }
  walk(root);
  return found;
}

function tableNames(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' " +
    "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' " +
    "ORDER BY name",
  ).all().map(row => row.name);
}

function normalizeValue(value) {
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString("base64") };
  if (typeof value === "bigint") return { int64: value.toString() };
  return value;
}

function tableDigest(db, table) {
  const identifier = '"' + table.replaceAll('"', '""') + '"';
  const statement = db.prepare("SELECT * FROM " + identifier);
  const lines = statement.all().map(row =>
    JSON.stringify(Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]),
    )),
  ).sort();
  return {
    rows: lines.length,
    digest: createHash("sha256").update(lines.join("\n")).digest("hex"),
    columns: db.prepare("PRAGMA table_info(" + identifier + ")").all().map(col => [
      col.name, col.type, col.notnull, col.pk,
    ]),
  };
}

function checkIntegrity(db, name) {
  const result = db.prepare("PRAGMA integrity_check").all();
  if (result.length !== 1 || result[0].integrity_check !== "ok") {
    throw new Error(name + " failed PRAGMA integrity_check: " + JSON.stringify(result));
  }
  const invalidForeignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (invalidForeignKeys.length > 0) {
    throw new Error(name + " has invalid foreign keys: " + JSON.stringify(invalidForeignKeys.slice(0, 10)));
  }
}

function main() {
  const sourceDir = resolve(arg("--source-dir"));
  const sqlPath = resolve(arg("--backup"));
  const sentinel = argv.includes("--sentinel") ? arg("--sentinel") : null;
  if (argv.includes("--remote")) {
    throw new Error("Remote / production backups must never be touched by this local verification command.");
  }
  const candidates = findDbFiles(sourceDir);
  // Miniflare also creates an internal SQLite store. Select only the ONE
  // database that actually has our application tables; fail if ambiguous.
  const sources = candidates.filter(file => {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const names = new Set(tableNames(db));
      return names.has("parts") && names.has("categories") &&
        names.has("import_batches") && names.has("stock_movements");
    } finally {
      db?.close();
    }
  });
  if (sources.length !== 1) {
    throw new Error("Expected exactly one application D1 SQLite database, found " +
      sources.length + " among " + candidates.length + " SQLite files. Refusing ambiguous comparison.");
  }
  const sourcePath = resolve(sources[0]);
  const sql = readFileSync(sqlPath, "utf8");
  if (sql.length < 100 || !sql.toUpperCase().includes("CREATE TABLE")) {
    throw new Error("Backup file is empty or does not include its schema.");
  }
  const temp = mkdtempSync(join(tmpdir(), "d1-restore-verify-"));
  const targetPath = join(temp, "restore.sqlite");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const restored = new DatabaseSync(targetPath);
  try {
    // D1's SQL export can insert child rows before creating a referenced
    // table. SQLite dumps must be restored with foreign keys temporarily
    // disabled, then fully checked after all tables have been created.
    // This writes ONLY into the disposable database in OS tmpdir.
    restored.exec("PRAGMA foreign_keys = OFF;");
    restored.exec(sql);
    restored.exec("PRAGMA foreign_keys = ON;");
    checkIntegrity(source, "Source");
    checkIntegrity(restored, "Restored backup");
    const sourceTables = tableNames(source);
    const restoredTables = tableNames(restored);
    if (JSON.stringify(sourceTables) !== JSON.stringify(restoredTables)) {
      throw new Error(
        "Schema tables differ; source=" + sourceTables.join(",") +
        "; restored=" + restoredTables.join(","),
      );
    }
    if (sourceTables.length < 10) {
      throw new Error("Too few application tables in backup: " + sourceTables.length);
    }
    let totalRows = 0;
    for (const name of sourceTables) {
      const original = tableDigest(source, name);
      const replica = tableDigest(restored, name);
      if (JSON.stringify(original) !== JSON.stringify(replica)) {
        throw new Error(
          "Backup restore differs in table " + name +
          "; source=" + JSON.stringify(original) +
          "; restored=" + JSON.stringify(replica),
        );
      }
      totalRows += original.rows;
    }
    if (sentinel) {
      const rows = restored.prepare("SELECT model_number FROM parts WHERE model_number=?")
        .all(sentinel);
      if (rows.length !== 1) throw new Error("The expected sentinel part was not restored.");
    }
    if (totalRows === 0) throw new Error("An empty backup cannot satisfy recovery verification.");
    stdout.write(
      "BACKUP RESTORE VERIFIED: " + sourceTables.length + " tables, " +
      totalRows + " rows, byte-equivalent normalized rows and matching column layouts.\n",
    );
  } finally {
    restored.close();
    source.close();
    rmSync(temp, { recursive: true, force: true });
  }
}

main();
