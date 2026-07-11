import { useEffect, useState } from "react";
import { Search, Upload, Plus, Pencil, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useCrm } from "@/context";
import { PageHeader, Avatar, EntityIcon, CategoryBadge, EmptyState } from "@/components/shared";
import { ConnectionsIndicator } from "@/components/connections-indicator";
import { ContactDialog } from "@/components/contacts/contact-dialog";
import { ImportContacts } from "@/components/contacts/import-contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Contact } from "@/types";

export function ContactsPage({ navigate }: { navigate: (to: string) => void }) {
  const { contacts, contactsPag, stats, setContactsPage, setContactsSort, setContactsSearch, deleteContact } = useCrm();

  const [search, setSearch] = useState(contactsPag.search);
  const [importOpen, setImportOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounce the search box → server-side filter.
  useEffect(() => {
    const t = setTimeout(() => setContactsSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (c: Contact) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const totalPages = Math.max(1, Math.ceil(contactsPag.total / contactsPag.limit));

  const addButton = (
    <Button size="sm" onClick={openCreate}>
      <Plus className="size-4" />
      Add contact
    </Button>
  );

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteContact(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Contacts" count={stats.contacts}>
        <ConnectionsIndicator />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts…"
            aria-label="Search contacts"
            className="h-9 w-56 pl-8"
          />
        </div>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="size-4" />
          Import
        </Button>
        {addButton}
      </PageHeader>

      {contacts.length === 0 ? (
        <EmptyState
          title="No contacts yet. Add your first, or import a CSV/XLSX."
          action={addButton}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader col="first_name" pag={contactsPag} onSort={setContactsSort}>Name</SortHeader>
                  <SortHeader col="email" pag={contactsPag} onSort={setContactsSort}>Email</SortHeader>
                  <TableHead>Phone</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Title</TableHead>
                  <SortHeader col="status" pag={contactsPag} onSort={setContactsSort}>Status</SortHeader>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => {
                  const fullName = `${c.first_name} ${c.last_name}`.trim();
                  return (
                    <TableRow key={c.id} className="hover:bg-secondary">
                      <TableCell>
                        <button
                          onClick={() => navigate(`/contacts/${c.id}`)}
                          aria-label={`View ${fullName || "contact"}`}
                          className="flex items-center gap-2.5 text-left font-medium hover:underline"
                        >
                          <Avatar firstName={c.first_name} lastName={c.last_name} />
                          <span>{fullName || "—"}</span>
                        </button>
                      </TableCell>
                      <TableCell>
                        {c.email ? (
                          <a href={`mailto:${c.email}`} className="text-[var(--ring)] hover:underline">
                            {c.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.phone ? <span className="tabular">{c.phone}</span> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.company_name ? (
                          <span className="flex items-center gap-2">
                            <EntityIcon name={c.company_name} domain={c.company_domain} />
                            <span>{c.company_name}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.title || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <CategoryBadge value={c.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`Edit ${fullName || "contact"}`}
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${fullName || "contact"}`}
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <footer className="flex items-center justify-between border-t border-border px-6 py-3">
            <span className="tabular text-[0.8125rem] text-muted-foreground">
              Page {contactsPag.page} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={contactsPag.page <= 1}
                onClick={() => setContactsPage(contactsPag.page - 1)}
                aria-label="Previous page"
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={contactsPag.page >= totalPages}
                onClick={() => setContactsPage(contactsPag.page + 1)}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </footer>
        </div>
      )}

      <ContactDialog open={dialogOpen} onOpenChange={setDialogOpen} contact={editing} />
      <ImportContacts open={importOpen} onOpenChange={setImportOpen} />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete contact?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${`${deleteTarget.first_name} ${deleteTarget.last_name}`.trim() || "This contact"} will be permanently removed. This can't be undone.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" variant="outline">Cancel</Button>
            </DialogClose>
            <Button size="sm" variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortHeader({
  col,
  pag,
  onSort,
  children,
  className,
}: {
  col: string;
  pag: { sort: string; order: "asc" | "desc" };
  onSort: (col: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const active = pag.sort === col;
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(col)}
        aria-label={`Sort by ${col}`}
        className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground", active && "text-foreground")}
      >
        {children}
        {active && (pag.order === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />)}
      </button>
    </TableHead>
  );
}
