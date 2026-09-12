import { openSshTunnel, parseSshTarget } from "../tunnel.js";
import { MySqlDriver } from "./mysql.js";
import { PostgresDriver } from "./postgres.js";
import { SqliteDriver } from "./sqlite.js";
import type { DbDriver } from "./types.js";

export * from "./types.js";

export interface ConnectOptions {
  /** Only used for postgres. */
  schema?: string;
  /** SSH bastion to tunnel through (postgres/mysql only). */
  sshTarget?: string;
  sshKeyPath?: string;
}

function detectDialect(connectionString: string): "postgres" | "mysql" | "sqlite" {
  if (connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://")) {
    return "postgres";
  }
  if (connectionString.startsWith("mysql://")) {
    return "mysql";
  }
  if (connectionString.startsWith("sqlite://") || connectionString.startsWith("sqlite:")) {
    return "sqlite";
  }
  // Bare filesystem paths (./data.db, /path/to.sqlite, :memory:) are assumed to be SQLite.
  return "sqlite";
}

function sqlitePathFromConnectionString(connectionString: string): string {
  if (connectionString.startsWith("sqlite://")) {
    return connectionString.slice("sqlite://".length);
  }
  if (connectionString.startsWith("sqlite:")) {
    return connectionString.slice("sqlite:".length);
  }
  return connectionString;
}

/**
 * Connects to a database given a connection string, auto-detecting the
 * dialect (postgres://, mysql://, or a SQLite file path / sqlite: URI).
 * If `sshTarget` is set, a tunnel is opened first (not supported for SQLite,
 * which is a local file, not a network service).
 */
export async function connectDriver(
  connectionString: string,
  options: ConnectOptions = {}
): Promise<{ driver: DbDriver; closeTunnel: () => void }> {
  const dialect = detectDialect(connectionString);

  if (dialect === "sqlite") {
    if (options.sshTarget) {
      throw new Error(
        "SSH tunneling is not supported for SQLite — it's a local file, not a network service. " +
          "Copy the file locally first (e.g. `scp`) and point --source/--target at the local path."
      );
    }
    const driver = await SqliteDriver.connect(sqlitePathFromConnectionString(connectionString));
    return { driver, closeTunnel: () => {} };
  }

  let effectiveConnectionString = connectionString;
  let closeTunnel = () => {};

  if (options.sshTarget) {
    const tunnel = await openSshTunnel(parseSshTarget(options.sshTarget), connectionString, options.sshKeyPath);
    effectiveConnectionString = tunnel.connectionString;
    closeTunnel = tunnel.close;
  }

  if (dialect === "postgres") {
    const driver = await PostgresDriver.connect(effectiveConnectionString, options.schema ?? "public");
    return { driver, closeTunnel };
  }

  const driver = await MySqlDriver.connect(effectiveConnectionString);
  return { driver, closeTunnel };
}
