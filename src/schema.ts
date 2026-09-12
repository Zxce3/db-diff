import type { Client } from "pg";

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string | null;
}

export interface IndexInfo {
  name: string;
  definition: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  primaryKey: string[];
  indexes: IndexInfo[];
}

export interface DatabaseSchema {
  tables: Map<string, TableSchema>;
}

export async function introspectSchema(client: Client, schemaName = "public"): Promise<DatabaseSchema> {
  const tablesResult = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schemaName]
  );

  const tables = new Map<string, TableSchema>();

  for (const row of tablesResult.rows) {
    const tableName = row.table_name;

    const columnsResult = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schemaName, tableName]
    );

    const pkResult = await client.query<{ column_name: string }>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
      [schemaName, tableName]
    );

    const indexResult = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = $1 AND tablename = $2
       ORDER BY indexname`,
      [schemaName, tableName]
    );

    tables.set(tableName, {
      name: tableName,
      columns: columnsResult.rows.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        isNullable: c.is_nullable === "YES",
        defaultValue: c.column_default,
      })),
      primaryKey: pkResult.rows.map((r) => r.column_name),
      indexes: indexResult.rows.map((i) => ({ name: i.indexname, definition: i.indexdef })),
    });
  }

  return { tables };
}

export async function getRowCount(client: Client, tableName: string, schemaName = "public"): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${schemaName}"."${tableName}"`
  );
  return Number(result.rows[0].count);
}
