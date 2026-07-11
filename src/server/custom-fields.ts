/**
 * Custom properties — server side.
 *
 * A custom property is a user-defined field on an entity type. Each def maps to
 * a REAL column on the entity's table (added via ALTER TABLE at definition
 * time), so values are native, indexable columns rather than a JSON blob — the
 * repo's own convention (every queryable field is a column; JSON only for the
 * opaque `activities.meta` bag).
 *
 * This module owns: the `custom_field_defs` registry CRUD, the schema-sync that
 * keeps each entity table's columns in step with its defs, and value coercion
 * for the entity write paths.
 */

import { get, query, run } from "./db.js";

export type EntityType = "contact" | "company" | "deal";

/** Base storage types. Widget flavours (score, badge, url…) ride on these via
 *  `custom_field` and are purely presentational — the server only sees the base. */
export type AttributeType =
  | "string"
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "enumeration"
  | "json";

export interface CustomFieldDef {
  id: string;
  entity_type: EntityType;
  key: string;
  label: string;
  field_type: AttributeType;
  custom_field: string; // widget registry uid, or "" for a bare base type
  options: Record<string, unknown>;
  position: number;
  created_at: string;
  updated_at: string;
}

interface CustomFieldDefRow extends Omit<CustomFieldDef, "options"> {
  options: string;
}

// entity type → real table name.
export const ENTITY_TABLES: Record<EntityType, string> = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
};

export function isEntityType(v: string): v is EntityType {
  return v === "contact" || v === "company" || v === "deal";
}

// Built-in columns per table — a custom key may never collide with these, so
// schema-sync can never add/drop a platform column.
const BUILTIN_COLUMNS: Record<EntityType, ReadonlySet<string>> = {
  company: new Set(["id", "name", "domain", "industry", "phone", "email", "notes", "created_at", "updated_at"]),
  contact: new Set(["id", "first_name", "last_name", "email", "phone", "company_id", "title", "status", "created_at", "updated_at"]),
  deal: new Set(["id", "name", "contact_id", "value", "stage", "close_date", "notes", "created_at", "updated_at"]),
};

const KEY_RE = /^[a-z][a-z0-9_]*$/;

/** Throws a human-readable Error if `key` is not a safe, non-reserved column. */
export function assertValidKey(entity: EntityType, key: string): void {
  if (!KEY_RE.test(key)) {
    throw new Error(`Invalid field key "${key}" — use lowercase letters, digits, and underscores (must start with a letter).`);
  }
  if (BUILTIN_COLUMNS[entity].has(key)) {
    throw new Error(`"${key}" is a built-in ${entity} field and can't be used as a custom property.`);
  }
}

function quote(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"';
}

// ── Registry CRUD ─────────────────────────────────────────────────────

function rowToDef(row: CustomFieldDefRow): CustomFieldDef {
  return { ...row, options: parseOptions(row.options) };
}

function parseOptions(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function listDefs(entity?: EntityType): Promise<CustomFieldDef[]> {
  const rows = entity
    ? await query<CustomFieldDefRow>(
        "SELECT * FROM custom_field_defs WHERE entity_type = ? ORDER BY position, created_at",
        [entity],
      )
    : await query<CustomFieldDefRow>("SELECT * FROM custom_field_defs ORDER BY entity_type, position, created_at");
  return rows.map(rowToDef);
}

export async function getDef(id: string): Promise<CustomFieldDef | null> {
  const row = await get<CustomFieldDefRow>("SELECT * FROM custom_field_defs WHERE id = ?", [id]);
  return row ? rowToDef(row) : null;
}

export interface CustomFieldInput {
  entity_type: EntityType;
  key: string;
  label: string;
  field_type: AttributeType;
  custom_field?: string;
  options?: Record<string, unknown>;
  position?: number;
}

/** Create a def and add its column. Throws on bad/duplicate key. */
export async function createDef(input: CustomFieldInput): Promise<CustomFieldDef> {
  assertValidKey(input.entity_type, input.key);
  const existing = await get("SELECT id FROM custom_field_defs WHERE entity_type = ? AND key = ?", [
    input.entity_type,
    input.key,
  ]);
  if (existing) throw new Error(`A "${input.key}" property already exists on ${input.entity_type}.`);

  const id = crypto.randomUUID();
  await run(
    "INSERT INTO custom_field_defs (id, entity_type, key, label, field_type, custom_field, options, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      input.entity_type,
      input.key,
      input.label,
      input.field_type,
      input.custom_field ?? "",
      JSON.stringify(input.options ?? {}),
      input.position ?? 0,
    ],
  );
  await syncEntityColumns(input.entity_type);
  return (await getDef(id))!;
}

/** Update label/options/position/widget of a def. Key + field_type are immutable
 *  (changing storage would need a destructive column migration). */
export async function updateDef(
  id: string,
  patch: Partial<Pick<CustomFieldDef, "label" | "custom_field" | "options" | "position">>,
): Promise<CustomFieldDef | null> {
  const def = await getDef(id);
  if (!def) return null;
  await run(
    "UPDATE custom_field_defs SET label = ?, custom_field = ?, options = ?, position = ?, updated_at = datetime('now') WHERE id = ?",
    [
      patch.label ?? def.label,
      patch.custom_field ?? def.custom_field,
      JSON.stringify(patch.options ?? def.options),
      patch.position ?? def.position,
      id,
    ],
  );
  return getDef(id);
}

/** Delete a def and drop its column. */
export async function deleteDef(id: string): Promise<boolean> {
  const def = await getDef(id);
  if (!def) return false;
  await run("DELETE FROM custom_field_defs WHERE id = ?", [id]);
  // Guard again before touching DDL — never drop a built-in.
  if (KEY_RE.test(def.key) && !BUILTIN_COLUMNS[def.entity_type].has(def.key)) {
    const table = ENTITY_TABLES[def.entity_type];
    await run(`ALTER TABLE ${quote(table)} DROP COLUMN ${quote(def.key)}`).catch(() => {
      /* column may already be gone; deletion of the def is the source of truth */
    });
  }
  return true;
}

// ── Schema-sync ───────────────────────────────────────────────────────

function sqliteAffinity(t: AttributeType): string {
  switch (t) {
    case "integer":
    case "boolean":
      return "INTEGER";
    case "decimal":
      return "REAL";
    default:
      return "TEXT";
  }
}

interface ColumnInfo {
  name: string;
  type: string;
}

/** Idempotently add a real column for every def on this entity that doesn't yet
 *  have one. Never drops here — deletion is explicit via deleteDef. */
export async function syncEntityColumns(entity: EntityType): Promise<void> {
  const table = ENTITY_TABLES[entity];
  const cols = await query<ColumnInfo>(`PRAGMA table_info(${quote(table)})`);
  const have = new Set(cols.map((c) => c.name));
  const defs = await listDefs(entity);
  for (const def of defs) {
    if (!KEY_RE.test(def.key) || BUILTIN_COLUMNS[entity].has(def.key) || have.has(def.key)) continue;
    await run(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(def.key)} ${sqliteAffinity(def.field_type)}`);
  }
}

// ── Value coercion (entity write paths) ───────────────────────────────

/**
 * Coerce + validate one incoming custom value for its def. Returns a
 * SQL-bindable value (string | number | null). Throws on enum violation.
 */
export function coerceCustomValue(value: unknown, def: CustomFieldDef): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  switch (def.field_type) {
    case "boolean":
      return value ? 1 : 0;
    case "integer":
      return Math.trunc(Number(value));
    case "decimal":
      return Number(value);
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "enumeration": {
      const enumVals = def.options.enum;
      const s = String(value);
      if (Array.isArray(enumVals) && enumVals.length && !enumVals.map(String).includes(s)) {
        throw new Error(`${def.key}: "${s}" is not one of [${enumVals.join(", ")}]`);
      }
      return s;
    }
    default:
      return String(value);
  }
}
