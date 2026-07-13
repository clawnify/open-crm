import { useCrm } from "@/context";
import { Avatar, EntityIcon, CategoryBadge } from "@/components/shared";
import { CustomFieldDisplay, readCustom } from "@/lib/custom-fields";
import { PreviewPanel, PreviewSection, PreviewField, Empty } from "@/components/preview-panel";
import type { Contact } from "@/types";

export function ContactPreview({
  contact,
  onClose,
  onEdit,
}: {
  contact: Contact | null;
  onClose: () => void;
  onEdit: (c: Contact) => void;
}) {
  const { customFields } = useCrm();
  const fields = customFields.filter((d) => d.entity_type === "contact");

  if (!contact) return null;
  const fullName = `${contact.first_name} ${contact.last_name}`.trim();

  return (
    <PreviewPanel
      open
      onClose={onClose}
      onEdit={() => onEdit(contact)}
      icon={<Avatar firstName={contact.first_name} lastName={contact.last_name} />}
      title={fullName || "—"}
      subtitle={contact.title || undefined}
    >
      <PreviewSection title="Details">
        <PreviewField label="Job title">{contact.title || <Empty />}</PreviewField>
        <PreviewField label="Email">
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className="text-[var(--ring)] hover:underline">{contact.email}</a>
          ) : <Empty />}
        </PreviewField>
        <PreviewField label="Phone">{contact.phone || <Empty />}</PreviewField>
        <PreviewField label="Status"><CategoryBadge value={contact.status} /></PreviewField>
      </PreviewSection>

      <PreviewSection title="Company">
        {contact.company_name ? (
          <div className="flex items-center gap-2 px-3 py-2 text-sm">
            <EntityIcon name={contact.company_name} domain={contact.company_domain} />
            <span className="truncate font-medium text-foreground">{contact.company_name}</span>
          </div>
        ) : (
          <div className="px-3 py-2 text-sm text-muted-foreground">No company linked.</div>
        )}
      </PreviewSection>

      {fields.length > 0 && (
        <PreviewSection title="Properties">
          {fields.map((def) => {
            const v = readCustom(contact, def.key);
            return (
              <PreviewField key={def.id} label={def.label}>
                {v === null || v === undefined || v === "" ? <Empty /> : <CustomFieldDisplay def={def} value={v} full />}
              </PreviewField>
            );
          })}
        </PreviewSection>
      )}
    </PreviewPanel>
  );
}
