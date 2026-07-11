export type View = "contacts" | "companies" | "deals";
export type EntityType = "contact" | "company" | "deal";

export interface Company {
  id: string;
  name: string;
  domain: string;
  industry: string;
  phone: string;
  email: string;
  notes: string;
  contact_count?: number;
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

// A single row parsed from an uploaded CSV/XLSX, keyed by header.
export type ImportRow = Record<string, string>;

// The contact fields an uploaded column can map to. "full_name" is a virtual
// target that splits on the first space into first/last name.
export type ImportField =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "title"
  | "status"
  | "company"
  | "";
