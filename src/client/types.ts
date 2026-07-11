export type View = "contacts" | "companies" | "deals";
export type EntityType = "contact" | "company" | "deal";

/** Base storage type for a custom property. Widget flavours ride on top. */
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

/** A user-defined field on an entity type. Maps to a real column on the table. */
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

export interface Company {
  id: string;
  name: string;
  domain: string;
  industry: string;
  phone: string;
  email: string;
  notes: string;
  contact_count?: number;
  custom?: Record<string, unknown>; // write payload; on reads, values are flat columns
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company_id: string | null;
  title: string;
  status: string;
  company_name?: string | null;
  company_domain?: string | null;
  custom?: Record<string, unknown>; // write payload; on reads, values are flat columns
  created_at: string;
  updated_at: string;
}

export interface Deal {
  id: string;
  name: string;
  contact_id: string | null;
  value: number;
  stage: string;
  close_date: string;
  notes: string;
  contact_first_name?: string | null;
  contact_last_name?: string | null;
  company_name?: string | null;
  company_domain?: string | null;
  custom?: Record<string, unknown>; // write payload; on reads, values are flat columns
  created_at: string;
  updated_at: string;
}

export interface Stats {
  contacts: number;
  companies: number;
  deals: number;
  dealValue: number;
}

export interface PaginatedState {
  page: number;
  limit: number;
  total: number;
  sort: string;
  order: "asc" | "desc";
  search: string;
}

export interface CompanyLookup {
  id: string;
  name: string;
  domain: string;
}

export interface ContactLookup {
  id: string;
  first_name: string;
  last_name: string;
  company_name?: string | null;
  company_domain?: string | null;
}

export interface Activity {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  type: string; // note | email | meeting | slack | stage_change
  body: string;
  meta: string; // JSON string
  created_at: string;
}

export interface ConnectionStatus {
  email: boolean;
  meeting: boolean;
  slack: boolean;
}

// The fields an uploaded column can map to. "full_name" is a virtual target
// that splits on the first space into first/last name. The "company_*" targets
// carry attributes for the company that gets created/deduped from the "company"
// column, so a new company lands with its domain/industry/phone instead of a
// name-only stub.
export type ImportField =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "title"
  | "status"
  | "company"
  | "company_domain"
  | "company_industry"
  | "company_phone"
  | "";

// A row handed to importContacts: contact fields plus the flat company columns
// resolved server-side into a deduped company.
export type ImportRow = Partial<Contact> & {
  company?: string;
  company_domain?: string;
  company_industry?: string;
  company_phone?: string;
};
