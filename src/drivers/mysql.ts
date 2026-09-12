import mysql from "mysql2/promise";
import type { DatabaseSchema, DbDriver, TableSchema } from "./types.js";

export class MySqlDriver implements DbDriver {
  readonly dialect = "mysql" as const;
  private conn: mysql.Connection;
  private databaseName: string;

  private constructor(conn: mysql.Connection, databaseName: string) {
    this.conn = conn;
    this.databaseName = databaseName;
  }

  static async connect(connectionString: string): Promise<MySqlDriver> {
    const conn = await mysql.createConnection(connectionString);
    const url = new URL(connectionString);
    const databaseName = url.pathname.replace(/^\//, "");
    if (!databaseName) {
      throw new Error("MySQL connection string must include a database name");
    }
    return new MySqlDriver(conn, databaseName);
  }

  async introspectSchema(): Promise<DatabaseSchema> {
    const dbName = this.databaseName;

    const [tableRows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [dbName]
    );

    const tables = new Map<string, TableSchema>();

    for (const row of tableRows) {
      const tableName: string = row.table_name ?? row.TABLE_NAME;

      const [columnRows] = await this.conn.query<mysql.RowDataPacket[]>(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position`,
        [dbName, tableName]
      );

      const [pkRows] = await this.conn.query<mysql.RowDataPacket[]>(
        `SELECT column_name
         FROM information_schema.key_column_usage
         WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'
         ORDER BY ordinal_position`,
        [dbName, tableName]
      );

      const [indexRows] = await this.conn.query<mysql.RowDataPacket[]>(
        `SELECT DISTINCT index_name, non_unique
         FROM information_schema.statistics
         WHERE table_schema = ? AND table_name = ? AND index_name != 'PRIMARY'
         ORDER BY index_name`,
        [dbName, tableName]
      );

      tables.set(tableName, {
        name: tableName,
        columns: columnRows.map((c) => ({
          name: c.column_name ?? c.COLUMN_NAME,
          dataType: c.data_type ?? c.DATA_TYPE,
          isNullable: (c.is_nullable ?? c.IS_NULLABLE) === "YES",
          defaultValue: c.column_default ?? c.COLUMN_DEFAULT ?? null,
        })),
        primaryKey: pkRows.map((r) => r.column_name ?? r.COLUMN_NAME),
        indexes: indexRows.map((i) => {
          const name = i.index_name ?? i.INDEX_NAME;
          const unique = (i.non_unique ?? i.NON_UNIQUE) === 0;
          return { name, definition: `${unique ? "UNIQUE " : ""}INDEX ${name} ON ${tableName}` };
        }),
      });
    }

    return { tables };
  }

  async getRowCount(tableName: string): Promise<number> {
    const [rows] = await this.conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM \`${tableName}\``
    );
    return Number(rows[0].count);
  }

  async close(): Promise<void> {
    await this.conn.end();
  }
}
