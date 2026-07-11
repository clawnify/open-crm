# Custom Properties — Design Plan

HubSpot-style **custom properties**: user-defined fields on `contacts` /
`companies` / `deals` beyond the built-in columns. A definition is scoped to an
entity *type*, not a record, so properties are created and edited with an empty
database and exist before any record does.

Status: **design only** — build after the `feat/integrations` refactor lands,
branched off the committed base so the two don't entangle.

---

## 1. Storage — real columns via schema-sync (not a JSON blob)

Each entity keeps its typed base columns. A custom property becomes a **real
column** on the entity table, added at definition time:

```
ALTER TABLE contacts ADD COLUMN "<key>" <affinity>
```

A small **schema-sync** step (ported from the sibling `open-cms` template, where
it is already implemented and verified against D1) owns this: it diffs the
desired property set against the live `PRAGMA table_info(<table>)`, emits
non-destructive `ADD COLUMN`s, and surfaces destructive ops (drops / type
changes) behind an explicit confirmation. Affinity map: `integer`/`score` →
`INTEGER`, `decimal` → `REAL`, everything else → `TEXT`.

Values are written and read through the entity's **already-dynamic** column
builder — `server/index.ts` already composes `UPDATE <entity> SET <fields…>`
from a dynamic list, so custom columns slot into the existing pattern; only the
`INSERT` column list needs to become dynamic.

**Safety:** property `key` is validated to `^[a-z][a-z0-9_]*$` and every
identifier is quoted (`"` doubled) before interpolation — no injection surface
from user-named fields.

### Why real columns, not a JSON `custom` column

1. **The repo's own precedent.** Every *queryable* business field here is a real
   typed column (`contacts.status`, `deals.stage`, `deals.value`,
   `companies.industry`). JSON is used in exactly one place — `activities.meta`,
   an opaque bag that is never filtered or sorted. Custom properties are
   queryable fields, so by the codebase's own rule they belong in columns.
2. **The core operation.** Filter / sort / segment / report *by property* is the
   primary CRM workload, not an edge case. Under a JSON column every one of those
   is an un-indexed `json_extract(custom,'$.key')` full scan; as real columns
   they are native and indexable from day one.
3. **Prior art.** Baserow, NocoDB, and Salesforce custom fields all store
   user-defined queryable fields as real columns (dynamic DDL) precisely to index
   and filter at the DB layer. JSON-blob custom fields are the known
   anti-pattern for anything you query.
4. **Efficiency over the feature's life.** JSON looks smaller *today* but forces
   schema-sync later anyway (once segmentation matters) plus a blob→column data
   migration. Real columns reuse machinery that already exists and is verified,
   and align with the already-dynamic write path — less total work, not more.

**Ceiling (priced, not blocking):** each deployed app has its own D1 database, so
column count is bounded by one organisation's custom fields — comfortably under
SQLite's per-table limit. If one property becomes a hot cross-entity filter it
can gain an index; nothing needs to move.

## 2. Definitions table

`custom_field_defs` is the per-entity property registry and the domain object
(rename / reorder / retype / delete lifecycle):

| column         | notes                                              |
| -------------- | -------------------------------------------------- |
| `id`           | UUID (app-generated, matches the entity tables)    |
| `entity_type`  | `contact` \| `company` \| `deal`                   |
| `key`          | column name; `^[a-z][a-z0-9_]*$`                    |
| `label`        | display name                                       |
| `field_type`   | base type (drives affinity + coercion)             |
| `custom_field` | widget registry uid, nullable (see §3)             |
| `options`      | JSON — widget config (score min/max, badge colors) |
| `position`     | ordering in tables / forms                         |
| timestamps     | `created_at`, `updated_at`                         |

`UNIQUE(entity_type, key)`.

## 3. Widget registry (reused)

The widget registry from `open-cms` (`custom-fields.tsx`: Score, Badge, URL,
Email, Phone, Tags + `badgeColor` + the `<Pill>` primitive) ports nearly as-is.
An attribute references a widget by `custom_field` uid over its base
`field_type`. **One change:** badge/score colors map to this repo's `DESIGN.md`
tokens (`success` / `warning` / `danger` tints) instead of raw values, so they
match the design system. Badge remains an `enumeration`-typed field so it keeps
server-side value validation for free.

## 4. API

- `GET/POST/PATCH/DELETE /api/custom-fields?entity=contact` — CRUD the defs.
  Create/delete drive schema-sync (`ADD COLUMN` / confirmed `DROP COLUMN`).
- Entity write paths accept the property columns present on the request,
  validated against their defs (badge → enum check, score/number → coercion).
- Entity read paths return the property columns alongside the built-ins.

## 5. Where you create them — a record-independent Properties screen

Custom fields are entity-type-scoped, so their management UI **cannot** live
inside a record view (`contact-dialog`, a contact's detail). It lives in a
dedicated **Properties** screen reachable from the sidebar — HubSpot's *Settings
→ Properties → object* model — and works with an empty database.

- **`sidebar.tsx`** — add a second nav group under the existing "Records" group:

  ```
  Records     Contacts · Companies · Deals
  Settings    Properties  → /settings/properties
  ```

- **`use-router.ts`** — add `{ name: "properties" }` parsing `/settings/properties`.
- **Properties page** — tabs Contact | Company | Deal, each listing that entity's
  `custom_field_defs` with a "＋ New property" editor (the open-crm analog of
  open-cms's `field-editor`). This is the canonical, always-available home and
  the natural first-run starting point: define properties, then add or import
  records. It also becomes the home for future schema-level settings (deal
  stages, import mappings).

## 6. Client dispatch (two touch points per entity)

- **Tables** (`contacts-page`, `companies-page`, `deals-board`): render one column
  per def after the built-ins → registry `Cell`.
- **Dialogs** (`contact-dialog`, `company-dialog`, `deal-dialog`): render one
  input per def after the built-in fields → registry `Input`.

## 7. Import inference (the payoff)

`/api/contacts/import` already exists. Extend it so unmapped spreadsheet columns
auto-create defs with an inferred type — `https://` → URL, `@` → email, 0–100 int
→ score, ≤12 distinct values → badge, `;`-delimited → tags — running the same
`custom_field_defs` + schema-sync path as the manual Properties screen. This is
what turns a 40+-column spreadsheet drop into a native-looking CRM instead of
dropped columns, and it's the single biggest reason custom properties earn their
keep here.

## 8. Scope boundaries (opinionated)

- No relations-as-custom-property — contact→company is already native.
- No range type — a `"13–15"` value is a `string` or two number properties.
- Server-side sort/filter uses real columns; no `json_extract` path exists.

## 9. First-run / empty state

The create-a-property flow must not depend on records existing:

- The zero-row list view (e.g. Contacts with no contacts) shows an empty-state
  card that links **"Set up properties"** alongside "＋ New contact", guiding a
  fresh CRM to schema before data.
- Each list view's column/gear menu carries an **"Add property"** shortcut that
  deep-links into the Properties screen for that entity. The list *page* renders
  its header even at zero rows, so this is reachable when empty.
- Because defs are entity-type-scoped and `ADD COLUMN` runs on an empty table,
  "properties before records" is the intended onboarding order — the manual
  screen and the importer converge on the same path.

## 10. Sequencing

Build after `feat/integrations` is committed, branched off that base. Rough
shape once it lands: one migration (`custom_field_defs` + schema-sync port), the
`/api/custom-fields` endpoints + dynamic INSERT, the widget registry copy with
token remap, the Properties screen (+ sidebar/router entry), two dispatch points
per entity, and the import inference.
