import type { ColumnInfo, DatabaseSchema, TableSchema } from "./drivers/types.js";

export interface ColumnDiff {
  name: string;
  kind: "added" | "removed" | "changed";
  before?: ColumnInfo;
  after?: ColumnInfo;
}

export interface TableDiff {
  name: string;
  kind: "added" | "removed" | "changed";
  columnDiffs: ColumnDiff[];
  primaryKeyChanged: boolean;
  addedIndexes: string[];
  removedIndexes: string[];
}

export interface RowCountDiff {
  table: string;
  sourceCount: number;
  targetCount: number;
  delta: number;
  percentChange: number | null;
}

export interface SchemaDiff {
  addedTables: string[];
  removedTables: string[];
  changedTables: TableDiff[];
}

function diffColumns(before: TableSchema, after: TableSchema): ColumnDiff[] {
  const beforeCols = new Map(before.columns.map((c) => [c.name, c]));
  const afterCols = new Map(after.columns.map((c) => [c.name, c]));
  const diffs: ColumnDiff[] = [];

  for (const [name, col] of afterCols) {
    if (!beforeCols.has(name)) {
      diffs.push({ name, kind: "added", after: col });
    }
  }

  for (const [name, col] of beforeCols) {
    const afterCol = afterCols.get(name);
    if (!afterCol) {
      diffs.push({ name, kind: "removed", before: col });
    } else if (
      afterCol.dataType !== col.dataType ||
      afterCol.isNullable !== col.isNullable ||
      afterCol.defaultValue !== col.defaultValue
    ) {
      diffs.push({ name, kind: "changed", before: col, after: afterCol });
    }
  }

  return diffs;
}

export function diffSchemas(source: DatabaseSchema, target: DatabaseSchema): SchemaDiff {
  const addedTables: string[] = [];
  const removedTables: string[] = [];
  const changedTables: TableDiff[] = [];

  for (const [name, targetTable] of target.tables) {
    if (!source.tables.has(name)) {
      addedTables.push(name);
    }
  }

  for (const [name, sourceTable] of source.tables) {
    const targetTable = target.tables.get(name);
    if (!targetTable) {
      removedTables.push(name);
      continue;
    }

    const columnDiffs = diffColumns(sourceTable, targetTable);
    const primaryKeyChanged =
      sourceTable.primaryKey.join(",") !== targetTable.primaryKey.join(",");

    const sourceIndexNames = new Set(sourceTable.indexes.map((i) => i.name));
    const targetIndexNames = new Set(targetTable.indexes.map((i) => i.name));
    const addedIndexes = [...targetIndexNames].filter((n) => !sourceIndexNames.has(n));
    const removedIndexes = [...sourceIndexNames].filter((n) => !targetIndexNames.has(n));

    if (columnDiffs.length > 0 || primaryKeyChanged || addedIndexes.length || removedIndexes.length) {
      changedTables.push({
        name,
        kind: "changed",
        columnDiffs,
        primaryKeyChanged,
        addedIndexes,
        removedIndexes,
      });
    }
  }

  return { addedTables, removedTables, changedTables };
}

export function diffRowCounts(
  sourceCounts: Map<string, number>,
  targetCounts: Map<string, number>
): RowCountDiff[] {
  const tables = new Set([...sourceCounts.keys(), ...targetCounts.keys()]);
  const diffs: RowCountDiff[] = [];

  for (const table of tables) {
    const sourceCount = sourceCounts.get(table) ?? 0;
    const targetCount = targetCounts.get(table) ?? 0;
    const delta = targetCount - sourceCount;
    const percentChange = sourceCount === 0 ? null : (delta / sourceCount) * 100;
    diffs.push({ table, sourceCount, targetCount, delta, percentChange });
  }

  return diffs.sort((a, b) => a.table.localeCompare(b.table));
}
