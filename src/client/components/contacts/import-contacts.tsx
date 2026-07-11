import { useState } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, ArrowLeft } from "lucide-react";
import { useCrm } from "@/context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { ImportField, ImportRow } from "@/types";

type Step = "upload" | "map" | "done";

interface Parsed {
  headers: string[];
  rows: string[][];
}

interface ImportResult {
  imported: number;
  companiesCreated: number;
  skipped: number;
}

// Radix Select items cannot use an empty-string value, so the "Skip" option uses
// this sentinel and is treated as "" everywhere in the mapping logic.
const SKIP = "__skip__";

const FIELD_OPTIONS: { label: string; value: string }[] = [
  { label: "— Skip —", value: SKIP },
  { label: "Full name (split)", value: "full_name" },
  { label: "First name", value: "first_name" },
  { label: "Last name", value: "last_name" },
  { label: "Email", value: "email" },
  { label: "Phone", value: "phone" },
  { label: "Title", value: "title" },
  { label: "Company", value: "company" },
  { label: "Company domain", value: "company_domain" },
  { label: "Company industry", value: "company_industry" },
  { label: "Company phone", value: "company_phone" },
  { label: "Status", value: "status" },
];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const EXACT: Record<string, ImportField> = {
  firstname: "first_name", first: "first_name", givenname: "first_name", forename: "first_name", fname: "first_name",
  lastname: "last_name", last: "last_name", surname: "last_name", familyname: "last_name", lname: "last_name",
  fullname: "full_name", name: "full_name", contactname: "full_name",
  email: "email", emailaddress: "email", mail: "email", primaryemail: "email",
  phone: "phone", phonenumber: "phone", mobile: "phone", mobilephone: "phone", cell: "phone", telephone: "phone", tel: "phone",
  title: "title", jobtitle: "title", role: "title", position: "title",
  company: "company", companyname: "company", organization: "company", organisation: "company", account: "company", employer: "company",
  companydomain: "company_domain", domain: "company_domain", website: "company_domain", companywebsite: "company_domain",
  industry: "company_industry", companyindustry: "company_industry", sector: "company_industry", vertical: "company_industry",
  status: "status", stage: "status", lifecyclestage: "status",
};
const FUZZY: [RegExp, ImportField][] = [
  [/^(first|given|fore)name/, "first_name"],
  [/^(last|sur|family)name/, "last_name"],
  [/^phone|phone$|mobile|^cell/, "phone"],
  [/^email|email$/, "email"],
  [/company|organi|employer/, "company"],
  [/domain|website/, "company_domain"],
  [/industry|sector/, "company_industry"],
  [/jobtitle|^title$|position/, "title"],
];
function autoMap(headers: string[]): ImportField[] {
  const result: ImportField[] = headers.map(() => "");
  const used = new Set<ImportField>();
  headers.forEach((h, i) => { const f = EXACT[norm(h)]; if (f && !used.has(f)) { result[i] = f; used.add(f); } });
  headers.forEach((h, i) => { if (result[i]) return; const n = norm(h); for (const [re, f] of FUZZY) { if (re.test(n) && !used.has(f)) { result[i] = f; used.add(f); break; } } });
  return result;
}

export function ImportContacts({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { importContacts, setError } = useCrm();
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setStep("upload");
    setBusy(false);
    setFileName("");
    setParsed(null);
    setMapping([]);
    setResult(null);
  }

  function handleOpenChange(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
      const nonEmpty = grid.filter((r) => r.some((c) => String(c).trim() !== ""));
      if (nonEmpty.length < 2) throw new Error("File needs a header row and at least one data row");
      const headers = nonEmpty[0].map((h) => String(h).trim());
      const rows = nonEmpty.slice(1).map((r) => headers.map((_, i) => String(r[i] ?? "")));
      setParsed({ headers, rows });
      setMapping(autoMap(headers));
      setStep("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
      setFileName("");
    } finally {
      setBusy(false);
    }
  }

  function backToUpload() {
    setParsed(null);
    setMapping([]);
    setFileName("");
    setStep("upload");
  }

  const hasName = mapping.some((f) => f === "first_name" || f === "full_name");

  async function onImport() {
    if (!parsed) return;
    setBusy(true);
    try {
      const contacts = parsed.rows.map((row) => {
        const out: ImportRow = {};
        parsed.headers.forEach((_, i) => {
          const field = mapping[i];
          const val = (row[i] || "").trim();
          if (!field || !val) return;
          if (field === "full_name") {
            const [first, ...rest] = val.split(/\s+/);
            out.first_name = out.first_name || first;
            if (rest.length && !out.last_name) out.last_name = rest.join(" ");
          } else {
            (out as Record<string, string>)[field] = val;
          }
        });
        return out;
      });
      const res = await importContacts(contacts);
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-muted-foreground" />
            Import contacts
          </DialogTitle>
        </DialogHeader>

        {step === "upload" && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input p-10 text-center transition-colors hover:border-primary hover:bg-secondary">
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={onFile}
              disabled={busy}
            />
            <Upload className="size-5 text-muted-foreground" />
            {busy ? (
              <span className="text-sm text-muted-foreground">Reading {fileName}…</span>
            ) : (
              <>
                <span className="text-sm font-medium">Choose a CSV or Excel file</span>
                <span className="text-xs text-muted-foreground">
                  .csv, .xlsx, or .xls — first row must be column headers
                </span>
              </>
            )}
          </label>
        )}

        {step === "map" && parsed && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Map columns from {fileName} ({parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}). Set at
              least one column to First name or Full name.
            </p>

            <div className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto pr-1">
              {parsed.headers.map((header, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{header || <span className="text-muted-foreground">Column {i + 1}</span>}</div>
                    <div className="truncate text-xs text-muted-foreground">{parsed.rows[0]?.[i] || "—"}</div>
                  </div>
                  <Select
                    value={mapping[i] === "" ? SKIP : mapping[i]}
                    onValueChange={(v) =>
                      setMapping((m) => {
                        const next = [...m];
                        next[i] = (v === SKIP ? "" : v) as ImportField;
                        return next;
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FIELD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-end sm:space-x-0">
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={backToUpload} disabled={busy}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button type="button" size="sm" onClick={onImport} disabled={busy || !hasName}>
                  {busy ? "Importing…" : `Import ${parsed.rows.length} ${parsed.rows.length === 1 ? "contact" : "contacts"}`}
                </Button>
              </div>
              {!hasName && (
                <p className="text-xs text-muted-foreground">
                  Map a column to First name or Full name to continue.
                </p>
              )}
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-emerald-600" />
            <p className="font-semibold">
              {result.imported} {result.imported === 1 ? "contact" : "contacts"} imported
            </p>
            <p className="text-sm text-muted-foreground">{doneDetail(result)}</p>
            <DialogFooter className="mt-2 w-full sm:justify-center">
              <Button type="button" size="sm" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function doneDetail(r: ImportResult): string {
  const parts: string[] = [];
  if (r.companiesCreated > 0) parts.push(`${r.companiesCreated} new ${r.companiesCreated === 1 ? "company" : "companies"}`);
  if (r.skipped > 0) parts.push(`${r.skipped} ${r.skipped === 1 ? "row" : "rows"} skipped (no name)`);
  return parts.length ? parts.join(" · ") : "All rows imported cleanly.";
}
