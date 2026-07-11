import { Users, Building2, CircleDollarSign } from "lucide-react";
import { useCrm } from "../context";
import { cn } from "../lib/utils";
import type { Route } from "../hooks/use-router";

const NAV = [
  { key: "contacts", path: "/contacts", label: "Contacts", icon: Users },
  { key: "companies", path: "/companies", label: "Companies", icon: Building2 },
  { key: "deals", path: "/deals", label: "Deals", icon: CircleDollarSign },
] as const;

export function Sidebar({ route, navigate }: { route: Route; navigate: (to: string) => void }) {
  const { stats } = useCrm();
  const counts: Record<string, number> = { contacts: stats.contacts, companies: stats.companies, deals: stats.deals };
  const activeKey = route.name === "contact" ? "contacts" : route.name;

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Users className="size-4" />
        </div>
        <span className="text-base font-bold tracking-tight text-sidebar-foreground">CRM</span>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        <div className="eyebrow px-2.5 pb-1.5 pt-2">Records</div>
        {NAV.map((item) => {
          const active = activeKey === item.key;
          return (
            <button
              key={item.key}
              onClick={() => navigate(item.path)}
              aria-label={`View ${item.label}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-secondary",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              <span className={cn("tabular text-xs", active ? "text-sidebar-accent-foreground" : "text-muted-foreground")}>
                {counts[item.key]}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
