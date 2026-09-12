import Database from "better-sqlite3";
import type { DatabaseSchema, DbDriver, TableSchema } from "./types.js";

interface SqliteTableInfoRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface SqliteIndexListRow {
  name: string;
  unique: number;
  origin: string;
}

interface SqliteIndexInfoRow {
  name: string;
}

export class SqliteDriver implements DbDriver {
  readonly dialect = "sqlite" as const;
  private db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static async connect(filePath: string): Promise<SqliteDriver> {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    return new SqliteDriver(db);
  }

  async introspectSchema(): Promise<DatabaseSchema> {
    const tableRows = this.db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as { name: string }[];

    const tables = new Map<string, TableSchema>();

    for (const { name: tableName } of tableRows) {
      const columnRows = this.db
        .prepare(`PRAGMA table_info("${tableName}")`)
        .all() as SqliteTableInfoRow[];

      const primaryKey = columnRows
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      const indexListRows = this.db
        .prepare(`PRAGMA index_list("${tableName}")`)
        .all() as SqliteIndexListRow[];

      const indexes = indexListRows
        .filter((idx) => idx.origin !== "pk")
        .map((idx) => {
          const columns = (
            this.db.prepare(`PRAGMA index_info("${idx.name}")`).all() as SqliteIndexInfoRow[]
          ).map((c) => c.name);
          return {
            name: idx.name,
            definition: `${idx.unique ? "UNIQUE " : ""}INDEX ${idx.name} ON ${tableName} (${columns.join(", ")})`,
          };
        });

      tables.set(tableName, {
        name: tableName,
        columns: columnRows.map((c) => ({
          name: c.name,
          dataType: c.type || "TEXT",
          isNullable: c.notnull === 0,
          defaultValue: c.dflt_value,
        })),
        primaryKey,
        indexes,
      });
    }

    return { tables };
  }

  async getRowCount(tableName: string): Promise<number> {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get() as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
