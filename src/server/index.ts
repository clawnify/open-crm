import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { initDB, query, get, run } from "./db.js";
import type { CredentialBinding } from "@clawnify/connections";
import { sendEmail, createMeeting, notifySlack, connectionStatus } from "./integrations.js";
import {
  listDefs,
  createDef,
  updateDef,
  deleteDef,
  coerceCustomValue,
  isEntityType,
  type EntityType,
} from "./custom-fields.js";

// In production Clawnify injects the CREDENTIALS broker binding + CLAWNIFY_ORG_ID
// whenever clawnify.json declares `app.credentials`. SLACK_CHANNEL is an optional
// custom env var: when set (and Slack is connected), won deals auto-notify it.
type Env = {
  Bindings: {
    DB: D1Database;
    CREDENTIALS?: CredentialBinding;
    CLAWNIFY_ORG_ID?: string;
    SLACK_CHANNEL?: string;
  };
};

/** Split an array into fixed-size chunks. Used to keep bulk SQL within D1's
 * 100-bound-parameter limit (the same cap applies to the preview-tier Facet). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Append a row to the activity timeline. Never throws — logging is best-effort. */
async function logActivity(
  entity_type: string,
  entity_id: string,
  type: string,
  body: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await run(
      "INSERT INTO activities (id, entity_type, entity_id, type, body, meta) VALUES (?, ?, ?, ?, ?, ?)",
      [crypto.randomUUID(), entity_type, entity_id, type, body, JSON.stringify(meta)],
    );
  } catch {
    /* timeline logging must never break the primary action */
  }
}

/**
 * Write custom-property values for one entity row. `custom` is the nested
 * object from the request body ({ key: value }); only keys with a matching def
 * are written, each coerced/validated for its type. Runs as a follow-up UPDATE
 * so the built-in INSERT/UPDATE paths stay untouched. Throws on enum violation.
 */
async function applyCustomValues(
  entity: EntityType,
  table: string,
  id: string,
  custom: Record<string, unknown> | undefined,
): Promise<void> {
  if (!custom || typeof custom !== "object") return;
  const defs = await listDefs(entity);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, raw] of Object.entries(custom)) {
    const def = byKey.get(key);
    if (!def) continue; // ignore unknown keys — only defined properties are writable
    sets.push(`"${key.replace(/"/g, '""')}" = ?`);
    params.push(coerceCustomValue(raw, def));
  }
  if (sets.length === 0) return;
  params.push(id);
  await run(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, params);
}

/** Reusable request-body field: the nested bag of custom-property values. */
const CustomValues = z.record(z.string(), z.any()).optional();

const app = new OpenAPIHono<Env>();

app.use("*", async (c, next) => {
  initDB(c.env);
  await next();
});

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  industry: z.string(),
  phone: z.string(),
  email: z.string(),
  notes: z.string(),
  contact_count: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Company");

const ContactSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  phone: z.string(),
  company_id: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  company_name: z.string().nullable().optional(),
  company_domain: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Contact");

const DealSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact_id: z.string().nullable(),
  value: z.number(),
  stage: z.string(),
  close_date: z.string(),
  notes: z.string(),
  contact_first_name: z.string().nullable().optional(),
  contact_last_name: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  company_domain: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Deal");

const IdParam = z.object({ id: z.string().openapi({ description: "Resource ID (integer)" }) });

const PaginationQuery = z.object({
  page: z.string().optional().openapi({ description: "Page number (default: 1)" }),
  limit: z.string().optional().openapi({ description: "Items per page (default: 25, max: 100)" }),
  sort: z.string().optional().openapi({ description: "Column to sort by" }),
  order: z.enum(["asc", "desc"]).optional().openapi({ description: "Sort direction (default: desc)" }),
  search: z.string().optional().openapi({ description: "Search term" }),
});

// ── Stats ──────────────────────────────────────────────────────────

const getStats = createRoute({
  method: "get",
  path: "/api/stats",
  tags: ["Stats"],
  summary: "Get dashboard statistics",
  responses: {
    200: {
      description: "Dashboard stats",
      content: { "application/json": { schema: z.object({
        contacts: z.number().int(),
        companies: z.number().int(),
        deals: z.number().int(),
        dealValue: z.number(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getStats, async (c) => {
  try {
    const contacts = await get<{ count: number }>("SELECT COUNT(*) as count FROM contacts");
    const companies = await get<{ count: number }>("SELECT COUNT(*) as count FROM companies");
    const deals = await get<{ count: number }>("SELECT COUNT(*) as count FROM deals");
    const dealValue = await get<{ total: number }>("SELECT COALESCE(SUM(value), 0) as total FROM deals WHERE stage NOT IN ('lost')");
    return c.json({
      contacts: contacts?.count || 0,
      companies: companies?.count || 0,
      deals: deals?.count || 0,
      dealValue: dealValue?.total || 0,
    }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Companies ──────────────────────────────────────────────────────

const listCompanies = createRoute({
  method: "get",
  path: "/api/companies",
  tags: ["Companies"],
  summary: "List companies with pagination, search, and filtering",
  request: {
    query: PaginationQuery.extend({
      industry: z.string().optional().openapi({ description: "Filter by industry" }),
    }),
  },
  responses: {
    200: {
      description: "Paginated companies",
      content: { "application/json": { schema: z.object({
        companies: z.array(CompanySchema),
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listCompanies, async (c) => {
  try {
    const q = c.req.valid("query");
    const page = Math.max(1, parseInt(q.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || "25", 10)));
    const offset = (page - 1) * limit;
    const search = (q.search || "").trim();
    const industry = (q.industry || "").trim();

    let sortCol = q.sort || "id";
    if (!["id", "name", "domain", "industry", "created_at"].includes(sortCol)) sortCol = "id";
    let order = (q.order || "desc").toLowerCase();
    if (order !== "asc" && order !== "desc") order = "desc";

    const where: string[] = [];
    const params: unknown[] = [];

    if (search) {
      where.push("(name LIKE ? OR domain LIKE ? OR email LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (industry) {
      where.push("industry = ?");
      params.push(industry);
    }

    const whereSQL = where.length ? " WHERE " + where.join(" AND ") : "";

    const countResult = await get<{ total: number }>(
      "SELECT COUNT(*) as total FROM companies" + whereSQL,
      [...params],
    );
    const total = countResult?.total || 0;

    const rows = await query(
      `SELECT c.*, (SELECT COUNT(*) FROM contacts WHERE company_id = c.id) as contact_count
       FROM companies c${whereSQL} ORDER BY c.${sortCol} ${order} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return c.json({ companies: rows, total, page, limit }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createCompany = createRoute({
  method: "post",
  path: "/api/companies",
  tags: ["Companies"],
  summary: "Create a new company",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().min(1),
        domain: z.string().optional(),
        industry: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        custom: CustomValues,
      }) } },
    },
  },
  responses: {
    201: { description: "Created company", content: { "application/json": { schema: z.object({ company: CompanySchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createCompany, async (c) => {
  try {
    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    const id = crypto.randomUUID();
    await run(
      "INSERT INTO companies (id, name, domain, industry, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, (body.domain || "").trim(), (body.industry || "").trim(), (body.phone || "").trim(), (body.email || "").trim(), (body.notes || "").trim()],
    );

    await applyCustomValues("company", "companies", id, body.custom);

    const inserted = await get("SELECT * FROM companies WHERE id = ?", [id]);
    return c.json({ company: inserted }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateCompany = createRoute({
  method: "put",
  path: "/api/companies/{id}",
  tags: ["Companies"],
  summary: "Update a company",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().optional(),
        domain: z.string().optional(),
        industry: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
        notes: z.string().optional(),
        custom: CustomValues,
      }) } },
    },
  },
  responses: {
    200: { description: "Updated company", content: { "application/json": { schema: z.object({ company: CompanySchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateCompany, async (c) => {
  try {
    const { id } = c.req.valid("param");
    if (!id) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const fields: string[] = [];
    const params: unknown[] = [];

    for (const key of ["name", "domain", "industry", "phone", "email", "notes"] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(typeof body[key] === "string" ? body[key].trim() : body[key]);
      }
    }

    const hasCustom = !!body.custom && Object.keys(body.custom).length > 0;
    if (fields.length === 0 && !hasCustom) return c.json({ error: "No fields to update" }, 400);

    const exists = await get("SELECT id FROM companies WHERE id = ?", [id]);
    if (!exists) return c.json({ error: "Company not found" }, 404);

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      await run("UPDATE companies SET " + fields.join(", ") + " WHERE id = ?", params);
    }
    await applyCustomValues("company", "companies", id, body.custom);

    const updated = await get("SELECT * FROM companies WHERE id = ?", [id]);
    return c.json({ company: updated }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteCompany = createRoute({
  method: "delete",
  path: "/api/companies/{id}",
  tags: ["Companies"],
  summary: "Delete a company",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteCompany, async (c) => {
  try {
    const { id } = c.req.valid("param");
    if (!id) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM companies WHERE id = ?", [id]);
    if (result.changes === 0) return c.json({ error: "Company not found" }, 404);
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Contacts ───────────────────────────────────────────────────────

const listContacts = createRoute({
  method: "get",
  path: "/api/contacts",
  tags: ["Contacts"],
  summary: "List contacts with pagination, search, and filtering",
  request: {
    query: PaginationQuery.extend({
      status: z.string().optional().openapi({ description: "Filter by status (lead, customer, etc.)" }),
      company_id: z.string().optional().openapi({ description: "Filter by company ID" }),
    }),
  },
  responses: {
    200: {
      description: "Paginated contacts",
      content: { "application/json": { schema: z.object({
        contacts: z.array(ContactSchema),
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listContacts, async (c) => {
  try {
    const q = c.req.valid("query");
    const page = Math.max(1, parseInt(q.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || "25", 10)));
    const offset = (page - 1) * limit;
    const search = (q.search || "").trim();
    const status = (q.status || "").trim();
    const companyId = q.company_id || "";

    let sortCol = q.sort || "id";
    if (!["id", "first_name", "last_name", "email", "status", "company_id", "created_at"].includes(sortCol)) sortCol = "id";
    let order = (q.order || "desc").toLowerCase();
    if (order !== "asc" && order !== "desc") order = "desc";

    const where: string[] = [];
    const params: unknown[] = [];

    if (search) {
      where.push("(ct.first_name LIKE ? OR ct.last_name LIKE ? OR ct.email LIKE ? OR ct.title LIKE ?)");
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push("ct.status = ?");
      params.push(status);
    }
    if (companyId) {
      where.push("ct.company_id = ?");
      params.push(companyId);
    }

    const whereSQL = where.length ? " WHERE " + where.join(" AND ") : "";

    const countResult = await get<{ total: number }>(
      "SELECT COUNT(*) as total FROM contacts ct" + whereSQL,
      [...params],
    );
    const total = countResult?.total || 0;

    const sortPrefix = ["id", "first_name", "last_name", "email", "status", "company_id", "created_at"].includes(sortCol) ? "ct." : "";

    const rows = await query(
      `SELECT ct.*, co.name as company_name, co.domain as company_domain
       FROM contacts ct
       LEFT JOIN companies co ON ct.company_id = co.id
       ${whereSQL}
       ORDER BY ${sortPrefix}${sortCol} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return c.json({ contacts: rows, total, page, limit }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createContact = createRoute({
  method: "post",
  path: "/api/contacts",
  tags: ["Contacts"],
  summary: "Create a new contact",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        first_name: z.string().min(1),
        last_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        company_id: z.string().nullable().optional(),
        title: z.string().optional(),
        status: z.string().optional(),
        custom: CustomValues,
      }) } },
    },
  },
  responses: {
    201: { description: "Created contact", content: { "application/json": { schema: z.object({ contact: ContactSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createContact, async (c) => {
  try {
    const body = c.req.valid("json");
    const firstName = body.first_name.trim();
    if (!firstName) return c.json({ error: "First name is required" }, 400);

    const companyId = body.company_id ? String(body.company_id) : null;

    const id = crypto.randomUUID();
    await run(
      "INSERT INTO contacts (id, first_name, last_name, email, phone, company_id, title, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, firstName, (body.last_name || "").trim(), (body.email || "").trim(), (body.phone || "").trim(), companyId, (body.title || "").trim(), (body.status || "lead").trim()],
    );

    await applyCustomValues("contact", "contacts", id, body.custom);

    const inserted = await get(
      `SELECT ct.*, co.name as company_name, co.domain as company_domain
       FROM contacts ct LEFT JOIN companies co ON ct.company_id = co.id
       WHERE ct.id = ?`,
      [id],
    );
    return c.json({ contact: inserted }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateContact = createRoute({
  method: "put",
  path: "/api/contacts/{id}",
  tags: ["Contacts"],
  summary: "Update a contact",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        company_id: z.string().nullable().optional(),
        title: z.string().optional(),
        status: z.string().optional(),
        custom: CustomValues,
      }) } },
    },
  },
  responses: {
    200: { description: "Updated contact", content: { "application/json": { schema: z.object({ contact: ContactSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateContact, async (c) => {
  try {
    const { id } = c.req.valid("param");
    if (!id) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const fields: string[] = [];
    const params: unknown[] = [];

    for (const key of ["first_name", "last_name", "email", "phone", "title", "status"] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(typeof body[key] === "string" ? body[key].trim() : body[key]);
      }
    }
    if (body.company_id !== undefined) {
      fields.push("company_id = ?");
      params.push(body.company_id ? String(body.company_id) : null);
    }

    const hasCustom = !!body.custom && Object.keys(body.custom).length > 0;
    if (fields.length === 0 && !hasCustom) return c.json({ error: "No fields to update" }, 400);

    const exists = await get("SELECT id FROM contacts WHERE id = ?", [id]);
    if (!exists) return c.json({ error: "Contact not found" }, 404);

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      await run("UPDATE contacts SET " + fields.join(", ") + " WHERE id = ?", params);
    }
    await applyCustomValues("contact", "contacts", id, body.custom);

    const updated = await get(
      `SELECT ct.*, co.name as company_name, co.domain as company_domain
       FROM contacts ct LEFT JOIN companies co ON ct.company_id = co.id
       WHERE ct.id = ?`,
      [id],
    );
    return c.json({ contact: updated }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteContact = createRoute({
  method: "delete",
  path: "/api/contacts/{id}",
  tags: ["Contacts"],
  summary: "Delete a contact",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteContact, async (c) => {
  try {
    const { id } = c.req.valid("param");
    if (!id) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM contacts WHERE id = ?", [id]);
    if (result.changes === 0) return c.json({ error: "Contact not found" }, 404);
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Deals ──────────────────────────────────────────────────────────

const getDealsBoard = createRoute({
  method: "get",
  path: "/api/deals/board",
  tags: ["Deals"],
  summary: "Get all deals for the pipeline board view",
  responses: {
    200: { description: "All deals with contact/company info", content: { "application/json": { schema: z.object({ deals: z.array(DealSchema) }) } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getDealsBoard, async (c) => {
  try {
    const rows = await query(
      `SELECT d.*,
              ct.first_name as contact_first_name, ct.last_name as contact_last_name,
              co.name as company_name, co.domain as company_domain
       FROM deals d
       LEFT JOIN contacts ct ON d.contact_id = ct.id
       LEFT JOIN companies co ON ct.company_id = co.id
       ORDER BY d.created_at ASC`,
    );
    return c.json({ deals: rows }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const listDeals = createRoute({
  method: "get",
  path: "/api/deals",
  tags: ["Deals"],
  summary: "List deals with pagination, search, and filtering",
  request: {
    query: PaginationQuery.extend({
      stage: z.string().optional().openapi({ description: "Filter by stage (prospect, qualified, proposal, negotiation, won, lost)" }),
      contact_id: z.string().optional().openapi({ description: "Filter by contact ID" }),
    }),
  },
  responses: {
    200: {
      description: "Paginated deals",
      content: { "application/json": { schema: z.object({
        deals: z.array(DealSchema),
        total: z.number().int(),
        page: z.number().int(),
        limit: z.number().int(),
        totalValue: z.number(),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(listDeals, async (c) => {
  try {
    const q = c.req.valid("query");
    const page = Math.max(1, parseInt(q.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(q.limit || "25", 10)));
    const offset = (page - 1) * limit;
    const search = (q.search || "").trim();
    const stage = (q.stage || "").trim();
    const contactId = q.contact_id || "";

    let sortCol = q.sort || "id";
    if (!["id", "name", "value", "stage", "close_date", "created_at"].includes(sortCol)) sortCol = "id";
    let order = (q.order || "desc").toLowerCase();
    if (order !== "asc" && order !== "desc") order = "desc";

    const where: string[] = [];
    const params: unknown[] = [];

    if (search) {
      where.push("(d.name LIKE ? OR d.notes LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (stage) {
      where.push("d.stage = ?");
      params.push(stage);
    }
    if (contactId) {
      where.push("d.contact_id = ?");
      params.push(contactId);
    }

    const whereSQL = where.length ? " WHERE " + where.join(" AND ") : "";

    const countResult = await get<{ total: number }>(
      "SELECT COUNT(*) as total FROM deals d" + whereSQL,
      [...params],
    );
    const total = countResult?.total || 0;

    const agg = await get<{ total_value: number }>(
      "SELECT COALESCE(SUM(d.value), 0) as total_value FROM deals d" + whereSQL,
      [...params],
    );

    const rows = await query(
      `SELECT d.*,
              ct.first_name as contact_first_name, ct.last_name as contact_last_name,
              co.name as company_name, co.domain as company_domain
       FROM deals d
       LEFT JOIN contacts ct ON d.contact_id = ct.id
       LEFT JOIN companies co ON ct.company_id = co.id
       ${whereSQL}
       ORDER BY d.${sortCol} ${order}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return c.json({ deals: rows, total, page, limit, totalValue: agg?.total_value || 0 }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const createDeal = createRoute({
  method: "post",
  path: "/api/deals",
  tags: ["Deals"],
  summary: "Create a new deal",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().min(1),
        contact_id: z.string().nullable().optional(),
        value: z.union([z.number(), z.string()]).optional(),
        stage: z.string().optional(),
        close_date: z.string().optional(),
        notes: z.string().optional(),
        custom: CustomValues,
      }) } },
    },
  },
  responses: {
    201: { description: "Created deal", content: { "application/json": { schema: z.object({ deal: DealSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createDeal, async (c) => {
  try {
    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    const contactId = body.contact_id ? String(body.contact_id) : null;
    const value = parseFloat(String(body.value)) || 0;

    const id = crypto.randomUUID();
    await run(
      "INSERT INTO deals (id, name, contact_id, value, stage, close_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, name, contactId, value, (body.stage || "prospect").trim(), (body.close_date || "").trim(), (body.notes || "").trim()],
    );

    await applyCustomValues("deal", "deals", id, body.custom);

    const inserted = await get(
      `SELECT d.*, ct.first_name as contact_first_name, ct.last_name as contact_last_name,
              co.name as company_name, co.domain as company_domain
       FROM deals d
       LEFT JOIN contacts ct ON d.contact_id = ct.id
       LEFT JOIN companies co ON ct.company_id = co.id
       WHERE d.id = ?`,
      [id],
    );
    return c.json({ deal: inserted }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const updateDeal = createRoute({
  method: "put",
  path: "/api/deals/{id}",
  tags: ["Deals"],
  summary: "Update a deal",
  request: {
    params: IdParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({
        name: z.string().optional(),
        contact_id: z.string().nullable().optional(),
        value: z.union([z.number(), z.string()]).optional(),
        stage: z.string().optional(),
        close_date: z.string().optional(),
        notes: z.string().optional(),
        custom: CustomValues,
      }) } },
    },
  },
  responses: {
    200: { description: "Updated deal", content: { "application/json": { schema: z.object({ deal: DealSchema }) } } },
    400: { description: "Validation error", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateDeal, async (c) => {
  try {
    const { id } = c.req.valid("param");
    if (!id) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const fields: string[] = [];
    const params: unknown[] = [];

    for (const key of ["name", "stage", "close_date", "notes"] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(typeof body[key] === "string" ? body[key].trim() : body[key]);
      }
    }
    if (body.value !== undefined) {
      fields.push("value = ?");
      params.push(parseFloat(String(body.value)) || 0);
    }
    if (body.contact_id !== undefined) {
      fields.push("contact_id = ?");
      params.push(body.contact_id ? String(body.contact_id) : null);
    }

    const hasCustom = !!body.custom && Object.keys(body.custom).length > 0;
    if (fields.length === 0 && !hasCustom) return c.json({ error: "No fields to update" }, 400);

    const exists = await get("SELECT id FROM deals WHERE id = ?", [id]);
    if (!exists) return c.json({ error: "Deal not found" }, 404);

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      params.push(id);
      await run("UPDATE deals SET " + fields.join(", ") + " WHERE id = ?", params);
    }
    await applyCustomValues("deal", "deals", id, body.custom);

    const updated = await get<Record<string, unknown>>(
      `SELECT d.*, ct.first_name as contact_first_name, ct.last_name as contact_last_name,
              co.name as company_name, co.domain as company_domain
       FROM deals d
       LEFT JOIN contacts ct ON d.contact_id = ct.id
       LEFT JOIN companies co ON ct.company_id = co.id
       WHERE d.id = ?`,
      [id],
    );

    // Deal just marked won → log it and notify Slack (best-effort, never blocks
    // the update). Fires only when this request set stage='won'.
    if (body.stage === "won" && updated) {
      const value = Number(updated.value) || 0;
      await logActivity("deal", id, "stage_change", `Deal marked won`, { stage: "won", value });
      const channel = c.env.SLACK_CHANNEL?.trim();
      if (channel) {
        const contact = [updated.contact_first_name, updated.contact_last_name].filter(Boolean).join(" ");
        const text = `🎉 *Deal won:* ${updated.name} — $${value.toLocaleString()}${contact ? ` (${contact})` : ""}`;
        try {
          await notifySlack(c.env, { channel, text });
          await logActivity("deal", id, "slack", `Notified #${channel} of the win`, { channel });
        } catch {
          /* Slack not connected / channel missing — the win is still recorded */
        }
      }
    }
    return c.json({ deal: updated }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const deleteDeal = createRoute({
  method: "delete",
  path: "/api/deals/{id}",
  tags: ["Deals"],
  summary: "Delete a deal",
  request: { params: IdParam },
  responses: {
    200: { description: "Success", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid ID", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteDeal, async (c) => {
  try {
    const { id } = c.req.valid("param");
    if (!id) return c.json({ error: "Invalid ID" }, 400);

    const result = await run("DELETE FROM deals WHERE id = ?", [id]);
    if (result.changes === 0) return c.json({ error: "Deal not found" }, 404);
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Lookup endpoints (for select dropdowns) ────────────────────────

const allCompanies = createRoute({
  method: "get",
  path: "/api/companies/all",
  tags: ["Lookups"],
  summary: "Get all companies for dropdown selects",
  responses: {
    200: {
      description: "All companies (id, name, domain)",
      content: { "application/json": { schema: z.object({
        companies: z.array(z.object({
          id: z.string(),
          name: z.string(),
          domain: z.string(),
        })),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(allCompanies, async (c) => {
  try {
    const companies = await query("SELECT id, name, domain FROM companies ORDER BY name ASC");
    return c.json({ companies }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

const allContacts = createRoute({
  method: "get",
  path: "/api/contacts/all",
  tags: ["Lookups"],
  summary: "Get all contacts for dropdown selects",
  responses: {
    200: {
      description: "All contacts with company info",
      content: { "application/json": { schema: z.object({
        contacts: z.array(z.object({
          id: z.string(),
          first_name: z.string(),
          last_name: z.string(),
          company_name: z.string().nullable(),
          company_domain: z.string().nullable(),
        })),
      }) } },
    },
    500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(allContacts, async (c) => {
  try {
    const contacts = await query(
      `SELECT ct.id, ct.first_name, ct.last_name, co.name as company_name, co.domain as company_domain
       FROM contacts ct LEFT JOIN companies co ON ct.company_id = co.id ORDER BY ct.first_name ASC`,
    );
    return c.json({ contacts }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Activity timeline ──────────────────────────────────────────────
// Plain Hono handlers (not createRoute) to keep the integration surface
// compact; validation is done inline in the same defensive style as above.

const ENTITY_TYPES = ["contact", "company", "deal"];

app.get("/api/activities", async (c) => {
  try {
    const entity_type = (c.req.query("entity_type") || "").trim();
    const entity_id = (c.req.query("entity_id") || "").trim();
    if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
      return c.json({ error: "entity_type and entity_id are required" }, 400);
    }
    const activities = await query(
      "SELECT * FROM activities WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, id DESC",
      [entity_type, entity_id],
    );
    return c.json({ activities }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post("/api/activities", async (c) => {
  try {
    const body = await c.req.json<{ entity_type?: string; entity_id?: string; type?: string; body?: string }>();
    const entity_type = (body.entity_type || "").trim();
    const entity_id = (body.entity_id || "").trim();
    if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
      return c.json({ error: "entity_type and entity_id are required" }, 400);
    }
    const text = (body.body || "").trim();
    if (!text) return c.json({ error: "Note body is required" }, 400);
    await logActivity(entity_type, entity_id, (body.type || "note").trim(), text);
    return c.json({ ok: true }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Integrations (Clawnify connections) ────────────────────────────

app.get("/api/integrations/status", async (c) => {
  try {
    return c.json(await connectionStatus(c.env), 200);
  } catch {
    return c.json({ email: false, meeting: false, slack: false }, 200);
  }
});

// Email a contact via connected Gmail, then log it on the contact's timeline.
app.post("/api/integrations/email", async (c) => {
  try {
    const body = await c.req.json<{ contact_id?: string; subject?: string; body?: string }>();
    const contactId = (body.contact_id || "").trim();
    const subject = (body.subject || "").trim();
    const text = (body.body || "").trim();
    if (!contactId) return c.json({ error: "contact_id is required" }, 400);
    if (!subject && !text) return c.json({ error: "A subject or body is required" }, 400);

    const contact = await get<{ email: string; first_name: string; last_name: string }>(
      "SELECT email, first_name, last_name FROM contacts WHERE id = ?",
      [contactId],
    );
    if (!contact) return c.json({ error: "Contact not found" }, 404);
    if (!contact.email) return c.json({ error: "Contact has no email address" }, 400);

    await sendEmail(c.env, { to: contact.email, subject, body: text });
    await logActivity("contact", contactId, "email", subject || "(no subject)", { to: contact.email });
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Schedule a Google Calendar meeting with a contact, then log it.
app.post("/api/integrations/meeting", async (c) => {
  try {
    const body = await c.req.json<{
      contact_id?: string;
      summary?: string;
      start_datetime?: string;
      timezone?: string;
      duration_minutes?: number;
    }>();
    const contactId = (body.contact_id || "").trim();
    const summary = (body.summary || "").trim();
    const start = (body.start_datetime || "").trim();
    if (!contactId) return c.json({ error: "contact_id is required" }, 400);
    if (!summary) return c.json({ error: "A meeting title is required" }, 400);
    if (!start) return c.json({ error: "A start time is required" }, 400);

    const contact = await get<{ email: string }>("SELECT email FROM contacts WHERE id = ?", [contactId]);
    if (!contact) return c.json({ error: "Contact not found" }, 404);

    const durationMinutes = Number(body.duration_minutes) || 30;
    const timezone = (body.timezone || "").trim() || "UTC";
    await createMeeting(c.env, {
      summary,
      startDatetime: start,
      timezone,
      durationHour: Math.floor(durationMinutes / 60),
      durationMinutes: durationMinutes % 60,
      attendees: contact.email ? [contact.email] : [],
    });
    await logActivity("contact", contactId, "meeting", summary, { start, timezone });
    return c.json({ ok: true }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Contact import (CSV / XLSX, mapped client-side) ────────────────
// The client parses the file and maps headers → fields, then posts clean rows
// here. Company names resolve to ids (reusing existing, creating new), then the
// contacts are bulk-inserted.
//
// This is written set-based, not row-by-row: company lookups use `IN (…)` and
// inserts use multi-row `VALUES (…),(…)`, chunked to stay under D1's 100
// bound-parameter cap (the same cap the preview-tier Facet enforces). A 2000-row
// import is ~150 statements, not ~2400 — it stays well inside the Worker's
// subrequest/duration budget and goes through @clawnify/db unchanged (so it also
// works on the DO-Facet preview binding, which has no batch()).
//
// Ceiling: chunks are not one atomic transaction (the adapter exposes no
// batch()/transaction). Companies are created before contacts so a mid-import
// failure can't orphan a contact's company_id; re-running is safe for companies
// (deduped by name) but may duplicate contacts. Upgrade to a single transaction
// if @clawnify/db ever exposes batch().

const CONTACT_STATUSES = ["lead", "active", "inactive", "churned"];
const CONTACT_COLS = 8; // id,first_name,last_name,email,phone,company_id,title,status
const CONTACT_CHUNK = Math.floor(100 / CONTACT_COLS); // 12 rows/stmt → 96 params ≤ 100
const LOOKUP_CHUNK = 100; // one-param `name IN (…)` lookups
const COMPANY_INSERT_CHUNK = 50; // (id, name) → 2 params/row → 100 params ≤ 100

app.post("/api/contacts/import", async (c) => {
  try {
    const body = await c.req.json<{
      contacts?: Array<{
        first_name?: string;
        last_name?: string;
        email?: string;
        phone?: string;
        title?: string;
        status?: string;
        company?: string;
      }>;
    }>();
    const rows = Array.isArray(body.contacts) ? body.contacts : [];
    if (rows.length === 0) return c.json({ error: "No rows to import" }, 400);
    if (rows.length > 2000) return c.json({ error: "Import is limited to 2000 rows at a time" }, 400);

    // Keep only rows with at least a first name; normalize fields.
    const clean = rows
      .map((r) => ({
        first_name: (r.first_name || "").trim(),
        last_name: (r.last_name || "").trim(),
        email: (r.email || "").trim(),
        phone: (r.phone || "").trim(),
        title: (r.title || "").trim(),
        status: CONTACT_STATUSES.includes((r.status || "").trim()) ? (r.status as string).trim() : "lead",
        company: (r.company || "").trim(),
      }))
      .filter((r) => r.first_name);
    const skipped = rows.length - clean.length;
    if (clean.length === 0) return c.json({ error: "No rows had a first name to import" }, 400);

    // ── Resolve company names → ids (set-based, case-insensitive) ──
    // Distinct names, keeping the first-seen original casing for any we create.
    const nameByKey = new Map<string, string>();
    for (const r of clean) {
      const key = r.company.toLowerCase();
      if (r.company && !nameByKey.has(key)) nameByKey.set(key, r.company);
    }
    const companyIds = new Map<string, number>(); // lowercased name → id

    const loadIds = async (names: string[]) => {
      for (const group of chunk(names, LOOKUP_CHUNK)) {
        const placeholders = group.map(() => "?").join(", ");
        const found = await query<{ id: string; name: string }>(
          `SELECT id, name FROM companies WHERE name COLLATE NOCASE IN (${placeholders})`,
          group,
        );
        for (const co of found) companyIds.set(co.name.toLowerCase(), co.id);
      }
    };

    const allNames = [...nameByKey.values()];
    await loadIds(allNames);

    // Create the ones that don't exist yet (multi-row insert), then reload ids.
    const missing = [...nameByKey].filter(([key]) => !companyIds.has(key)).map(([, name]) => name);
    for (const group of chunk(missing, COMPANY_INSERT_CHUNK)) {
      const placeholders = group.map(() => "(?, ?)").join(", ");
      const params = group.flatMap((name) => [crypto.randomUUID(), name]);
      await run(`INSERT INTO companies (id, name) VALUES ${placeholders}`, params);
    }
    if (missing.length) await loadIds(missing);
    const companiesCreated = missing.length;

    // ── Bulk-insert contacts (multi-row VALUES, chunked) ──
    let imported = 0;
    for (const group of chunk(clean, CONTACT_CHUNK)) {
      const placeholders = group.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const params: unknown[] = [];
      for (const r of group) {
        const companyId = r.company ? companyIds.get(r.company.toLowerCase()) ?? null : null;
        params.push(crypto.randomUUID(), r.first_name, r.last_name, r.email, r.phone, companyId, r.title, r.status);
      }
      await run(
        `INSERT INTO contacts (id, first_name, last_name, email, phone, company_id, title, status) VALUES ${placeholders}`,
        params,
      );
      imported += group.length;
    }

    return c.json({ imported, companiesCreated, skipped }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Single contact (for deep-linked detail view) ───────────────────
// Plain handler; the static /api/contacts/all route takes precedence in Hono.

app.get("/api/contacts/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id || id === "all") return c.json({ error: "Not found" }, 404);
    const contact = await get(
      `SELECT ct.*, co.name as company_name, co.domain as company_domain
       FROM contacts ct LEFT JOIN companies co ON ct.company_id = co.id
       WHERE ct.id = ?`,
      [id],
    );
    if (!contact) return c.json({ error: "Contact not found" }, 404);
    return c.json({ contact }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// ── Custom properties (field definitions + schema-sync) ────────────

app.get("/api/custom-fields", async (c) => {
  const entity = c.req.query("entity");
  if (entity && !isEntityType(entity)) return c.json({ error: "Invalid entity" }, 400);
  const defs = await listDefs(entity ? (entity as EntityType) : undefined);
  return c.json({ defs }, 200);
});

app.post("/api/custom-fields", async (c) => {
  try {
    const body = await c.req.json();
    if (!isEntityType(body.entity_type)) return c.json({ error: "Invalid entity_type" }, 400);
    if (!body.key || !body.label) return c.json({ error: "key and label are required" }, 400);
    const def = await createDef({
      entity_type: body.entity_type,
      key: String(body.key),
      label: String(body.label),
      field_type: body.field_type ?? "string",
      custom_field: body.custom_field ?? "",
      options: body.options ?? {},
      position: body.position ?? 0,
    });
    return c.json({ def }, 201);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/custom-fields/:id", async (c) => {
  try {
    const def = await updateDef(c.req.param("id"), await c.req.json());
    if (!def) return c.json({ error: "Not found" }, 404);
    return c.json({ def }, 200);
  } catch (err: unknown) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/custom-fields/:id", async (c) => {
  const ok = await deleteDef(c.req.param("id"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true }, 200);
});

// ── OpenAPI Doc ────────────────────────────────────────────────────

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "CRM App", version: "1.0.0", description: "A CRM with companies, contacts, and deal pipeline management." },
});

export default app;
