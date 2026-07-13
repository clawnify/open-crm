import { useEffect, type ReactNode } from "react";
import { X, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Right-hand slide-over that previews a single record (à la Twenty). Opens on
 * row click; shows the record's fields grouped into sections plus related
 * records, with an Edit shortcut. Uses theme tokens so it follows the app's
 * light/dark theme.
 */
export function PreviewPanel({
  open,
  onClose,
  icon,
  title,
  subtitle,
  onEdit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  onEdit?: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-foreground">{title}</div>
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="size-4" />
              Edit
            </Button>
          )}
          <Button size="icon" variant="ghost" className="size-8" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-auto px-5 py-5">{children}</div>
      </aside>
    </>
  );
}

export function PreviewSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {action}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">{children}</div>
    </div>
  );
}

export function PreviewField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
      <span className="w-28 shrink-0 pt-0.5 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-foreground [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

/** Placeholder for a blank field value. */
export function Empty() {
  return <span className="text-muted-foreground">Empty</span>;
}
