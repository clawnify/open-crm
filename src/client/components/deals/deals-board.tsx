import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useCrm } from "@/context";
import { PageHeader, Avatar, EntityIcon, CategoryBadge, EmptyState } from "@/components/shared";
import { DealDialog } from "@/components/deals/deal-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/utils";
import type { Deal } from "@/types";

const STAGES = ["prospect", "qualified", "proposal", "negotiation", "won", "lost"] as const;

export function DealsBoard() {
  const { boardDeals, stats, dealsTotalValue, updateDeal, deleteDeal } = useCrm();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Deal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (d: Deal) => {
    setEditing(d);
    setDialogOpen(true);
  };

  const addButton = (
    <Button size="sm" onClick={openCreate}>
      <Plus className="size-4" />
      Add deal
    </Button>
  );

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDeal(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Deals" count={stats.deals}>
        <div className="flex flex-col items-end">
          <div className="eyebrow">Pipeline value</div>
          <span className="tabular text-sm font-semibold">{formatMoney(dealsTotalValue)}</span>
        </div>
        {addButton}
      </PageHeader>

      {boardDeals.length === 0 ? (
        <EmptyState title="No deals yet. Add your first." action={addButton} />
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto">
          <div className="flex h-full min-w-max gap-4 p-6">
            {STAGES.map((stage) => {
              const columnDeals = boardDeals.filter((d) => d.stage === stage);
              const columnTotal = columnDeals.reduce((sum, d) => sum + (d.value || 0), 0);
              return (
                <div key={stage} className="flex w-72 shrink-0 flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CategoryBadge value={stage} />
                      <span className="tabular text-[0.8125rem] text-muted-foreground">{columnDeals.length}</span>
                    </div>
                    <span className="tabular text-[0.8125rem] font-medium text-muted-foreground">
                      {formatMoney(columnTotal)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    {columnDeals.map((d) => {
                      const contactName = `${d.contact_first_name ?? ""} ${d.contact_last_name ?? ""}`.trim();
                      return (
                        <Card key={d.id} className="flex flex-col gap-2 p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-medium">{d.name}</span>
                            <span className="tabular shrink-0 text-sm font-semibold">{formatMoney(d.value)}</span>
                          </div>

                          {d.company_name && (
                            <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                              <EntityIcon name={d.company_name} domain={d.company_domain} />
                              <span>{d.company_name}</span>
                            </span>
                          )}

                          {contactName && (
                            <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                              <Avatar firstName={d.contact_first_name} lastName={d.contact_last_name} className="size-5 text-[0.5625rem]" />
                              <span>{contactName}</span>
                            </span>
                          )}

                          <div className="mt-1 flex items-center justify-between gap-2">
                            <Select value="" onValueChange={(v) => updateDeal(d.id, { stage: v })}>
                              <SelectTrigger className="h-8 flex-1">
                                <SelectValue placeholder="Move to…" />
                              </SelectTrigger>
                              <SelectContent>
                                {STAGES.filter((s) => s !== d.stage).map((s) => (
                                  <SelectItem key={s} value={s} className="capitalize">
                                    {s}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              aria-label={`Edit ${d.name}`}
                              onClick={() => openEdit(d)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${d.name}`}
                              onClick={() => setDeleteTarget(d)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <DealDialog open={dialogOpen} onOpenChange={setDialogOpen} deal={editing} />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete deal?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `${deleteTarget.name || "This deal"} will be permanently removed. This can't be undone.`
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
