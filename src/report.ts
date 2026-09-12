import type { SchemaDiff } from "./diff.js";
import type { RowCountDiff } from "./diff.js";

export function formatSchemaDiff(diff: SchemaDiff): string {
  const lines: string[] = [];

  if (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    diff.changedTables.length === 0
  ) {
    lines.push("Schema: no differences found.");
    return lines.join("\n");
  }

  lines.push("Schema differences:");

  for (const table of diff.removedTables) {
    lines.push(`  - table "${table}" is missing in target`);
  }
  for (const table of diff.addedTables) {
    lines.push(`  + table "${table}" is new in target`);
  }

  for (const tableDiff of diff.changedTables) {
    lines.push(`  ~ table "${tableDiff.name}":`);
    for (const colDiff of tableDiff.columnDiffs) {
      if (colDiff.kind === "added") {
        lines.push(`      + column "${colDiff.name}" (${colDiff.after?.dataType}) added in target`);
      } else if (colDiff.kind === "removed") {
        lines.push(`      - column "${colDiff.name}" (${colDiff.before?.dataType}) missing in target`);
      } else {
        lines.push(
          `      ~ column "${colDiff.name}": source=${colDiff.before?.dataType}${
            colDiff.before?.isNullable ? "" : " NOT NULL"
          } target=${colDiff.after?.dataType}${colDiff.after?.isNullable ? "" : " NOT NULL"}`
        );
      }
    }
    if (tableDiff.primaryKeyChanged) {
      lines.push(`      ~ primary key differs`);
    }
    for (const idx of tableDiff.removedIndexes) {
      lines.push(`      - index "${idx}" missing in target`);
    }
    for (const idx of tableDiff.addedIndexes) {
      lines.push(`      + index "${idx}" new in target`);
    }
  }

  return lines.join("\n");
}

export function formatRowCountDiff(diffs: RowCountDiff[], threshold: number): string {
  const lines: string[] = ["Row count comparison:"];
  const flagged = diffs.filter(
    (d) => d.percentChange !== null && Math.abs(d.percentChange) >= threshold
  );

  for (const d of diffs) {
    const pct = d.percentChange === null ? "n/a" : `${d.percentChange.toFixed(1)}%`;
    const flag = d.percentChange !== null && Math.abs(d.percentChange) >= threshold ? "  <-- drift" : "";
    lines.push(`  ${d.table}: source=${d.sourceCount} target=${d.targetCount} delta=${d.delta} (${pct})${flag}`);
  }

  lines.push("");
  lines.push(
    flagged.length > 0
      ? `${flagged.length} table(s) exceed the ${threshold}% row-count drift threshold.`
      : `No tables exceed the ${threshold}% row-count drift threshold.`
  );

  return lines.join("\n");
}
