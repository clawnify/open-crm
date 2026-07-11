import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Map a color token (e.g. "sky") to a set of Tailwind classes for a card / badge surface. */
export const colorPalette = {
  sky:     { bg: "bg-sky-100",     border: "border-sky-300",     text: "text-sky-900",     ring: "ring-sky-400",     dot: "bg-sky-500" },
  emerald: { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-900", ring: "ring-emerald-400", dot: "bg-emerald-500" },
  amber:   { bg: "bg-amber-100",   border: "border-amber-300",   text: "text-amber-900",   ring: "ring-amber-400",   dot: "bg-amber-500" },
  rose:    { bg: "bg-rose-100",    border: "border-rose-300",    text: "text-rose-900",    ring: "ring-rose-400",    dot: "bg-rose-500" },
  violet:  { bg: "bg-violet-100",  border: "border-violet-300",  text: "text-violet-900",  ring: "ring-violet-400",  dot: "bg-violet-500" },
  fuchsia: { bg: "bg-fuchsia-100", border: "border-fuchsia-300", text: "text-fuchsia-900", ring: "ring-fuchsia-400", dot: "bg-fuchsia-500" },
  teal:    { bg: "bg-teal-100",    border: "border-teal-300",    text: "text-teal-900",    ring: "ring-teal-400",    dot: "bg-teal-500" },
  orange:  { bg: "bg-orange-100",  border: "border-orange-300",  text: "text-orange-900",  ring: "ring-orange-400",  dot: "bg-orange-500" },
  slate:   { bg: "bg-slate-100",   border: "border-slate-300",   text: "text-slate-900",   ring: "ring-slate-400",   dot: "bg-slate-500" },
} as const;

export type ColorToken = keyof typeof colorPalette;

export function colorClasses(token: string | null | undefined): typeof colorPalette[ColorToken] {
  return colorPalette[(token as ColorToken)] ?? colorPalette.sky;
}

const TOKENS = Object.keys(colorPalette) as ColorToken[];

/** Deterministically map any string to a stable category color token (DESIGN-APPS
 *  signature #4 — color = data). The same value always gets the same color. */
export function categoryToken(value: string): ColorToken {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return TOKENS[Math.abs(hash) % TOKENS.length];
}

/** Category classes for a value (badge/pill/avatar surface). */
export function categoryClasses(value: string | null | undefined) {
  return colorClasses(value ? categoryToken(value) : "slate");
}

export function getInitials(firstName?: string | null, lastName?: string | null): string {
  return ((firstName?.[0] || "") + (lastName?.[0] || "")).toUpperCase() || "?";
}

/** Format an ISO date string 'YYYY-MM-DD' or full datetime to a short date label. */
export function formatDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, opts ?? { year: "numeric", month: "short", day: "numeric" });
}

/** Format a number as currency. Uses USD by default. */
export function formatMoney(n: number | null | undefined, currency = "USD"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

/** YYYY-MM-DD for a given Date in local time. */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM for the current month. */
export function currentPeriod(): string {
  return toIsoDate(new Date()).slice(0, 7);
}

/** Add or subtract months from a 'YYYY-MM' string. */
export function addMonths(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Pretty 'April 2026' for 'YYYY-MM'. */
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Days between two ISO dates (positive = b after a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  return Math.round((db - da) / 86_400_000);
}
