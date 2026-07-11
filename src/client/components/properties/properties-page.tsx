import { useMemo, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { useCrm } from "@/context";
import { PageHeader } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  WIDGETS,
  BASE_TYPES,
  widgetMetaFor,
  createCustomField,
  deleteCustomField,
} from "@/lib/custom-fields";
import type { AttributeType, CustomFieldDef, EntityType } from "@/types";

const ENTITIES: { key: EntityType; label: string }[] = [
  { key: "contact", label: "Contacts" },
  { key: "company", label: "Companies" },
  { key: "deal", label: "Deals" },
];

// Combined type picker: bare base types + custom widgets, each with a stable id.
const TYPE_OPTIONS = [
  ...BASE_TYPES.map((b) => ({ id: `base:${b.field_type}`, ...b })),
  ...WIDGETS.map((w) => ({ id: `widget:${w.uid}`, ...w })),
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([0-9])/, "f_$1");
}

export function PropertiesPage() {
  const { customFields, refetchCustomFields, setError } = useCrm();
  const [entity, setEntity] = useState<EntityType>("contact");

  return (
    <>
      <PageHeader title="Properties" />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <p className="mb-4 max-w-xl text-sm text-muted-foreground">
          Custom properties are extra fields on your records. They're defined per object and work with an
          empty database — set them up here before importing or adding records.
        </p>
        <Tabs value={entity} onValueChange={(v) => setEntity(v as EntityType)}>
          <TabsList>
            {ENTITIES.map((e) => (
              <TabsTrigger key={e.key} value={e.key}>{e.label}</TabsTrigger>
            ))}
          </TabsList>
          {ENTITIES.map((e) => (
            <TabsContent key={e.key} value={e.key} className="mt-4">
              <EntityProperties
                entity={e.key}
                defs={customFields.filter((d) => d.entity_type === e.key)}
                onChanged={refetchCustomFields}
                onError={(m) => setError(m)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}

function EntityProperties({
  entity,
  defs,
  onChanged,
  onError,
}: {
  entity: EntityType;
  defs: CustomFieldDef[];
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const remove = async (def: CustomFieldDef) => {
    if (!confirm(`Delete "${def.label}"? This removes the column and its values for every ${entity}.`)) return;
    try {
      await deleteCustomField(def.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete property");
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="divide-y divide-border rounded-md border border-border">
        {defs.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No custom properties yet.</div>
        )}
        {defs.map((def) => {
          const w = widgetMetaFor(def);
          const Icon = w?.icon;
          return (
            <div key={def.id} className="flex items-center gap-3 px-4 py-2.5">
              {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{def.label}</div>
                <div className="truncate font-mono text-xs text-muted-foreground">{def.key}</div>
              </div>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                {w?.label ?? def.field_type}
              </span>
              <button onClick={() => remove(def)} aria-label={`Delete ${def.label}`}
                className="text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      <AddProperty entity={entity} existingKeys={defs.map((d) => d.key)} onChanged={onChanged} onError={onError} />
    </div>
  );
}

function AddProperty({
  entity,
  existingKeys,
  onChanged,
  onError,
}: {
  entity: EntityType;
  existingKeys: string[];
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [typeId, setTypeId] = useState(TYPE_OPTIONS[0].id);
  const [enumText, setEnumText] = useState("");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("100");
  const [busy, setBusy] = useState(false);

  const selected = TYPE_OPTIONS.find((t) => t.id === typeId)!;
  const key = slugify(label);
  const isEnum = selected.field_type === "enumeration";
  const isScore = selected.uid === "clawnify::score.score";
  const dupKey = existingKeys.includes(key);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !key || dupKey) return;
    const options: Record<string, unknown> = {};
    if (isEnum) options.enum = enumText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (isScore) { options.min = Number(min) || 0; options.max = Number(max) || 100; }
    setBusy(true);
    try {
      await createCustomField({
        entity_type: entity,
        key,
        label: label.trim(),
        field_type: selected.field_type as AttributeType,
        custom_field: selected.uid,
        options,
      });
      setLabel(""); setEnumText(""); setTypeId(TYPE_OPTIONS[0].id);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create property");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-border p-4">
      <div className="eyebrow">New property</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prop-label">Label</Label>
          <Input id="prop-label" value={label} placeholder="Fit Score" onChange={(e) => setLabel(e.target.value)} />
          {key && <span className="font-mono text-xs text-muted-foreground">{key}{dupKey && " — already exists"}</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Type</Label>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  <span className="inline-flex items-center gap-2"><t.icon className="size-3.5 opacity-60" />{t.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isEnum && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="prop-enum">Values (one per line)</Label>
          <textarea id="prop-enum" value={enumText} onChange={(e) => setEnumText(e.target.value)}
            placeholder={"Immediate\nStrong\nMonitor"}
            className="min-h-[80px] rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-sm" />
        </div>
      )}
      {isScore && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><Label htmlFor="prop-min">Min</Label>
            <Input id="prop-min" type="number" value={min} onChange={(e) => setMin(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="prop-max">Max</Label>
            <Input id="prop-max" type="number" value={max} onChange={(e) => setMax(e.target.value)} /></div>
        </div>
      )}

      <Button type="submit" size="sm" disabled={busy || !label.trim() || !key || dupKey} className="gap-1.5">
        <Plus className="size-3.5" /> {busy ? "Adding…" : "Add property"}
      </Button>
    </form>
  );
}
