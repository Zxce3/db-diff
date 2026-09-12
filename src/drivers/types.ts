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

export type Dialect = "postgres" | "mysql" | "sqlite";

export interface DbDriver {
  readonly dialect: Dialect;
  introspectSchema(): Promise<DatabaseSchema>;
  getRowCount(tableName: string): Promise<number>;
  close(): Promise<void>;
}
