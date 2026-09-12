import { describe, expect, it } from "vitest";
import { diffSchemas, diffRowCounts } from "./diff.js";
import type { DatabaseSchema } from "./drivers/types.js";

function schema(tables: DatabaseSchema["tables"] extends Map<string, infer T> ? T[] : never): DatabaseSchema {
  return { tables: new Map(tables.map((t) => [t.name, t])) };
}

describe("diffSchemas", () => {
  it("detects added and removed tables", () => {
    const source = schema([
      { name: "users", columns: [], primaryKey: [], indexes: [] },
    ]);
    const target = schema([
      { name: "orders", columns: [], primaryKey: [], indexes: [] },
    ]);

    const diff = diffSchemas(source, target);
    expect(diff.addedTables).toEqual(["orders"]);
    expect(diff.removedTables).toEqual(["users"]);
    expect(diff.changedTables).toEqual([]);
  });

  it("detects added, removed, and changed columns", () => {
    const source = schema([
      {
        name: "users",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "email", dataType: "text", isNullable: false, defaultValue: null },
        ],
        primaryKey: ["id"],
        indexes: [],
      },
    ]);
    const target = schema([
      {
        name: "users",
        columns: [
          { name: "id", dataType: "integer", isNullable: false, defaultValue: null },
          { name: "email", dataType: "text", isNullable: true, defaultValue: null },
          { name: "created_at", dataType: "timestamp", isNullable: true, defaultValue: null },
        ],
        primaryKey: ["id"],
        indexes: [],
      },
    ]);

    const diff = diffSchemas(source, target);
    expect(diff.changedTables).toHaveLength(1);
    const tableDiff = diff.changedTables[0];
    expect(tableDiff.columnDiffs).toContainEqual(
      expect.objectContaining({ name: "created_at", kind: "added" })
    );
    expect(tableDiff.columnDiffs).toContainEqual(
      expect.objectContaining({ name: "email", kind: "changed" })
    );
  });

  it("reports no diff for identical schemas", () => {
    const source = schema([
      {
        name: "users",
        columns: [{ name: "id", dataType: "integer", isNullable: false, defaultValue: null }],
        primaryKey: ["id"],
        indexes: [],
      },
    ]);
    const target = schema([
      {
        name: "users",
        columns: [{ name: "id", dataType: "integer", isNullable: false, defaultValue: null }],
        primaryKey: ["id"],
        indexes: [],
      },
    ]);

    const diff = diffSchemas(source, target);
    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
  });
});

describe("diffRowCounts", () => {
  it("computes delta and percent change", () => {
    const source = new Map([["users", 100]]);
    const target = new Map([["users", 120]]);

    const diffs = diffRowCounts(source, target);
    expect(diffs).toEqual([
      { table: "users", sourceCount: 100, targetCount: 120, delta: 20, percentChange: 20 },
    ]);
  });

  it("handles tables missing from one side", () => {
    const source = new Map([["users", 100]]);
    const target = new Map<string, number>();

    const diffs = diffRowCounts(source, target);
    expect(diffs).toEqual([
      { table: "users", sourceCount: 100, targetCount: 0, delta: -100, percentChange: -100 },
    ]);
  });

  it("returns null percentChange when source count is zero", () => {
    const source = new Map([["users", 0]]);
    const target = new Map([["users", 5]]);

    const diffs = diffRowCounts(source, target);
    expect(diffs[0].percentChange).toBeNull();
  });
});
