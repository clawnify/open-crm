import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api } from "@/api";
import { useCrm } from "@/context";
import { EntityIcon } from "@/components/shared";
import { CustomFieldDisplay, readCustom } from "@/lib/custom-fields";
import { PreviewPanel, PreviewSection, PreviewField, Empty } from "@/components/preview-panel";
import type { Company, Contact } from "@/types";

export function CompanyPreview({
  company,
  onClose,
  onEdit,
}: {
  company: Company | null;
  onClose: () => void;
  onEdit: (c: Company) => void;
}) {
  const { customFields } = useCrm();
  const fields = customFields.filter((d) => d.entity_type === "company");
  const [contacts, setContacts] = useState<Contact[]>([]);

  useEffect(() => {
    if (!company) return;
    setContacts([]);
    api<{ contacts: Contact[] }>("GET", `/api/contacts?company_id=${company.id}&limit=100`)
      .then((d) => setContacts(d.contacts))
      .catch(() => {});
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!company) return null;
  const host = (company.domain || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const href = /^https?:\/\//i.test(company.domain) ? company.domain : `https://${company.domain}`;

  return (
    <PreviewPanel
      open
      onClose={onClose}
      onEdit={() => onEdit(company)}
      icon={<EntityIcon name={company.name} domain={company.domain} className="size-9" />}
      title={company.name || "—"}
      subtitle={host || undefined}
    >
      <PreviewSection title="Details">
        <PreviewField label="Domain">
          {host ? (
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--ring)] hover:underline">
              {host}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : <Empty />}
        </PreviewField>
        <PreviewField label="Industry">{company.industry || <Empty />}</PreviewField>
        <PreviewField label="Phone">{company.phone || <Empty />}</PreviewField>
        <PreviewField label="Email">
          {company.email ? (
            <a href={`mailto:${company.email}`} className="text-[var(--ring)] hover:underline">{company.email}</a>
          ) : <Empty />}
        </PreviewField>
      </PreviewSection>

      {fields.length > 0 && (
        <PreviewSection title="Properties">
          {fields.map((def) => {
            const v = readCustom(company, def.key);
            return (
              <PreviewField key={def.id} label={def.label}>
                {v === null || v === undefined || v === "" ? <Empty /> : <CustomFieldDisplay def={def} value={v} full />}
              </PreviewField>
            );
          })}
        </PreviewSection>
      )}

      {company.notes && (
        <PreviewSection title="Notes">
          <div className="whitespace-pre-wrap px-3 py-2 text-sm text-foreground">{company.notes}</div>
        </PreviewSection>
      )}

      <PreviewSection title={`People · ${contacts.length}`}>
        {contacts.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No contacts yet.</div>
        ) : (
          contacts.map((ct) => (
            <div key={ct.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
              <span className="truncate font-medium text-foreground">{`${ct.first_name} ${ct.last_name}`.trim() || "—"}</span>
              <span className="truncate text-muted-foreground">{ct.title || ct.email || ""}</span>
            </div>
          ))
        )}
      </PreviewSection>
    </PreviewPanel>
  );
}
