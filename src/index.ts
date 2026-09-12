#!/usr/bin/env node
import { Command } from "commander";
import { Client } from "pg";
import { introspectSchema, getRowCount } from "./schema.js";
import { diffSchemas, diffRowCounts } from "./diff.js";
import { formatSchemaDiff, formatRowCountDiff } from "./report.js";
import { suggestMigration } from "./migration.js";
import { openSshTunnel, parseSshTarget, type TunnelHandle } from "./tunnel.js";

const program = new Command();

program
  .name("db-diff")
  .description(
    "Compares schemas and row-count distributions between two database instances and outputs a diff plus a migration script suggestion."
  )
  .requiredOption("--source <connectionString>", "connection string for the source database (e.g. staging)")
  .requiredOption("--target <connectionString>", "connection string for the target database (e.g. PR branch)")
  .option(
    "--source-ssh <user@host[:port]>",
    "SSH host to tunnel through to reach --source (e.g. a staging bastion)"
  )
  .option(
    "--target-ssh <user@host[:port]>",
    "SSH host to tunnel through to reach --target (e.g. a prod bastion)"
  )
  .option("--ssh-key <path>", "private key file to use for SSH tunnels (defaults to ~/.ssh/id_ed25519 or id_rsa)")
  .option("--schema <name>", "schema to compare", "public")
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

async function resolveConnectionString(
  connectionString: string,
  sshSpec: string | undefined,
  tunnels: TunnelHandle[]
): Promise<string> {
  if (!sshSpec) return connectionString;
  const tunnel = await openSshTunnel(parseSshTarget(sshSpec), connectionString, options.sshKey);
  tunnels.push(tunnel);
  return tunnel.connectionString;
}

async function main() {
  const tunnels: TunnelHandle[] = [];

  const [sourceConnectionString, targetConnectionString] = await Promise.all([
    resolveConnectionString(options.source, options.sourceSsh, tunnels),
    resolveConnectionString(options.target, options.targetSsh, tunnels),
  ]);

  const sourceClient = new Client({ connectionString: sourceConnectionString });
  const targetClient = new Client({ connectionString: targetConnectionString });

  await sourceClient.connect();
  await targetClient.connect();

  try {
    const [sourceSchema, targetSchema] = await Promise.all([
      introspectSchema(sourceClient, options.schema),
      introspectSchema(targetClient, options.schema),
    ]);

    const schemaDiff = diffSchemas(sourceSchema, targetSchema);

    const sourceCounts = new Map<string, number>();
    const targetCounts = new Map<string, number>();

    for (const tableName of sourceSchema.tables.keys()) {
      sourceCounts.set(tableName, await getRowCount(sourceClient, tableName, options.schema));
    }
    for (const tableName of targetSchema.tables.keys()) {
      targetCounts.set(tableName, await getRowCount(targetClient, tableName, options.schema));
    }

    const rowCountDiffs = diffRowCounts(sourceCounts, targetCounts);
    const threshold = Number(options.rowCountThreshold);

    console.log(formatSchemaDiff(schemaDiff));
    console.log();
    console.log(formatRowCountDiff(rowCountDiffs, threshold));

    const migrationSql = suggestMigration(schemaDiff, sourceSchema);

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
    await sourceClient.end();
    await targetClient.end();
    for (const tunnel of tunnels) tunnel.close();
  }
}

main().catch((err) => {
  console.error("db-diff failed:", err instanceof Error ? err.message : err);
  process.exitCode = 2;
});
