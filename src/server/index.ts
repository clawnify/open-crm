import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { initDB, query, get, run } from "./db.js";

type Env = { Bindings: { DB: D1Database } };

const app = new OpenAPIHono<Env>();

app.use("*", async (c, next) => {
  initDB(c.env);
  await next();
});

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const CompanySchema = z.object({
  id: z.number().int(),
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
  id: z.number().int(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string(),
  phone: z.string(),
  company_id: z.number().int().nullable(),
  title: z.string(),
  status: z.string(),
  company_name: z.string().nullable().optional(),
  company_domain: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Contact");

const DealSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  contact_id: z.number().int().nullable(),
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

    const result = await run(
      "INSERT INTO companies (name, domain, industry, phone, email, notes) VALUES (?, ?, ?, ?, ?, ?)",
      [name, (body.domain || "").trim(), (body.industry || "").trim(), (body.phone || "").trim(), (body.email || "").trim(), (body.notes || "").trim()],
    );

    const inserted = await get("SELECT * FROM companies WHERE id = ?", [result.lastInsertRowid]);
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
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const body = c.req.valid("json");
    const fields: string[] = [];
    const params: unknown[] = [];

    for (const key of ["name", "domain", "industry", "phone", "email", "notes"] as const) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(typeof body[key] === "string" ? body[key].trim() : body[key]);
      }
    }

    if (fields.length === 0) return c.json({ error: "No fields to update" }, 400);
    fields.push("updated_at = datetime('now')");
    params.push(id);

    const result = await run("UPDATE companies SET " + fields.join(", ") + " WHERE id = ?", params);
    if (result.changes === 0) return c.json({ error: "Company not found" }, 404);

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
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

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
      params.push(parseInt(companyId, 10));
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
        company_id: z.union([z.number().int(), z.string()]).nullable().optional(),
        title: z.string().optional(),
        status: z.string().optional(),
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

    const companyId = body.company_id ? parseInt(String(body.company_id), 10) : null;

    const result = await run(
      "INSERT INTO contacts (first_name, last_name, email, phone, company_id, title, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [firstName, (body.last_name || "").trim(), (body.email || "").trim(), (body.phone || "").trim(), companyId, (body.title || "").trim(), (body.status || "lead").trim()],
    );

    const inserted = await get(
      `SELECT ct.*, co.name as company_name, co.domain as company_domain
       FROM contacts ct LEFT JOIN companies co ON ct.company_id = co.id
       WHERE ct.id = ?`,
      [result.lastInsertRowid],
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
        company_id: z.union([z.number().int(), z.string()]).nullable().optional(),
        title: z.string().optional(),
        status: z.string().optional(),
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
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

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
      params.push(body.company_id ? parseInt(String(body.company_id), 10) : null);
    }

    if (fields.length === 0) return c.json({ error: "No fields to update" }, 400);
    fields.push("updated_at = datetime('now')");
    params.push(id);

    const result = await run("UPDATE contacts SET " + fields.join(", ") + " WHERE id = ?", params);
    if (result.changes === 0) return c.json({ error: "Contact not found" }, 404);

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
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

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
      params.push(parseInt(contactId, 10));
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
        contact_id: z.union([z.number().int(), z.string()]).nullable().optional(),
        value: z.union([z.number(), z.string()]).optional(),
        stage: z.string().optional(),
        close_date: z.string().optional(),
        notes: z.string().optional(),
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

    const contactId = body.contact_id ? parseInt(String(body.contact_id), 10) : null;
    const value = parseFloat(String(body.value)) || 0;

    const result = await run(
      "INSERT INTO deals (name, contact_id, value, stage, close_date, notes) VALUES (?, ?, ?, ?, ?, ?)",
      [name, contactId, value, (body.stage || "prospect").trim(), (body.close_date || "").trim(), (body.notes || "").trim()],
    );

    const inserted = await get(
      `SELECT d.*, ct.first_name as contact_first_name, ct.last_name as contact_last_name,
              co.name as company_name, co.domain as company_domain
       FROM deals d
       LEFT JOIN contacts ct ON d.contact_id = ct.id
       LEFT JOIN companies co ON ct.company_id = co.id
       WHERE d.id = ?`,
      [result.lastInsertRowid],
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
        contact_id: z.union([z.number().int(), z.string()]).nullable().optional(),
        value: z.union([z.number(), z.string()]).optional(),
        stage: z.string().optional(),
        close_date: z.string().optional(),
        notes: z.string().optional(),
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
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

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
      params.push(body.contact_id ? parseInt(String(body.contact_id), 10) : null);
    }

    if (fields.length === 0) return c.json({ error: "No fields to update" }, 400);
    fields.push("updated_at = datetime('now')");
    params.push(id);

    const result = await run("UPDATE deals SET " + fields.join(", ") + " WHERE id = ?", params);
    if (result.changes === 0) return c.json({ error: "Deal not found" }, 404);

    const updated = await get(
      `SELECT d.*, ct.first_name as contact_first_name, ct.last_name as contact_last_name,
              co.name as company_name, co.domain as company_domain
       FROM deals d
       LEFT JOIN contacts ct ON d.contact_id = ct.id
       LEFT JOIN companies co ON ct.company_id = co.id
       WHERE d.id = ?`,
      [id],
    );
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
    const { id: idStr } = c.req.valid("param");
    const id = parseInt(idStr, 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

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
          id: z.number().int(),
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
          id: z.number().int(),
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

// ── OpenAPI Doc ────────────────────────────────────────────────────

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: { title: "CRM App", version: "1.0.0", description: "A CRM with companies, contacts, and deal pipeline management." },
});

export default app;
