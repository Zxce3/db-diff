#!/usr/bin/env node
import { Command } from "commander";
import { connectDriver } from "./drivers/index.js";
import { diffSchemas, diffRowCounts } from "./diff.js";
import { formatSchemaDiff, formatRowCountDiff } from "./report.js";
import { suggestMigration } from "./migration.js";

const program = new Command();

program
  .name("db-diff")
  .description(
    "Compares schemas and row-count distributions between two database instances (Postgres, MySQL, or SQLite) and outputs a diff plus a migration script suggestion."
  )
  .requiredOption(
    "--source <connectionString>",
    "connection string for the source database (postgres://, mysql://, or a SQLite file path)"
  )
  .requiredOption(
    "--target <connectionString>",
    "connection string for the target database (postgres://, mysql://, or a SQLite file path)"
  )
  .option(
    "--source-ssh <user@host[:port]>",
    "SSH host to tunnel through to reach --source (postgres/mysql only, e.g. a staging bastion)"
  )
  .option(
    "--target-ssh <user@host[:port]>",
    "SSH host to tunnel through to reach --target (postgres/mysql only, e.g. a prod bastion)"
  )
  .option("--ssh-key <path>", "private key file to use for SSH tunnels (defaults to ~/.ssh/id_ed25519 or id_rsa)")
  .option("--schema <name>", "schema to compare (postgres only)", "public")
  .option("--row-count-threshold <percent>", "percent row-count delta considered drift", "20")
  .option("--fail-on-drift", "exit non-zero if schema drift or row-count drift is found", false)
  .option("--migration-out <path>", "write suggested migration SQL to this file instead of stdout")
  .parse(process.argv);

const options = program.opts<{
  source: string;
  target: string;
  sourceSsh?: string;
  targetSsh?: string;
  sshKey?: string;
  schema: string;
  rowCountThreshold: string;
  failOnDrift: boolean;
  migrationOut?: string;
}>();

async function main() {
  const [source, target] = await Promise.all([
    connectDriver(options.source, {
      schema: options.schema,
      sshTarget: options.sourceSsh,
      sshKeyPath: options.sshKey,
    }),
    connectDriver(options.target, {
      schema: options.schema,
      sshTarget: options.targetSsh,
      sshKeyPath: options.sshKey,
    }),
  ]);

  try {
    const [sourceSchema, targetSchema] = await Promise.all([
      source.driver.introspectSchema(),
      target.driver.introspectSchema(),
    ]);

    const schemaDiff = diffSchemas(sourceSchema, targetSchema);

    const sourceCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();

    for (const tableName of sourceSchema.tables.keys()) {
      sourceCounts.set(tableName, await source.driver.getRowCount(tableName));
    }
    for (const tableName of targetSchema.tables.keys()) {
      targetCounts.set(tableName, await target.driver.getRowCount(tableName));
    }

    const rowCountDiffs = diffRowCounts(sourceCounts, targetCounts);
    const threshold = Number(options.rowCountThreshold);

    console.log(formatSchemaDiff(schemaDiff));
    console.log();
    console.log(formatRowCountDiff(rowCountDiffs, threshold));

    if (source.driver.dialect !== target.driver.dialect) {
      console.log();
      console.log(
        `Note: source is ${source.driver.dialect}, target is ${target.driver.dialect} — the suggested migration ` +
          `uses ${source.driver.dialect} syntax and is a structural hint only, not directly runnable against target.`
      );
    }

    const migrationSql = suggestMigration(schemaDiff, sourceSchema, source.driver.dialect);

    if (options.migrationOut) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(options.migrationOut, migrationSql + "\n");
      console.log();
      console.log(`Suggested migration written to ${options.migrationOut}`);
    } else {
      console.log();
      console.log(migrationSql);
    }

    const hasSchemaDrift =
      schemaDiff.addedTables.length > 0 ||
      schemaDiff.removedTables.length > 0 ||
      schemaDiff.changedTables.length > 0;
    const hasRowCountDrift = rowCountDiffs.some(
      (d) => d.percentChange !== null && Math.abs(d.percentChange) >= threshold
    );

    if (options.failOnDrift && (hasSchemaDrift || hasRowCountDrift)) {
      process.exitCode = 1;
    }
  } finally {
    await source.driver.close();
    await target.driver.close();
    source.closeTunnel();
    target.closeTunnel();
  }
}

main().catch((err) => {
  console.error("db-diff failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
