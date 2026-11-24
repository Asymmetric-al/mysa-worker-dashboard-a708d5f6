/** Key-driven redaction for diagnostics and for every denial path. */ import { isRecord } from "@/lib/guards";
/** The single replacement marker, so a redacted cell is recognisable in a diagnostic and distinguishable from an empty string. */ export const REDACTED = "[redacted]";
/** The key names a `denied` outcome must never reveal, grouped by the evidence the denial has to withhold: */ export const DENIAL_VALUE_KEYS: readonly string[] = Object.freeze([
  "exists", // Existence and size evidence.
  "count",
  "size",
  "bytes",
  "length",
  "total",
  "totalCount",
  "id", // Identity and title evidence.
  "ids",
  "name",
  "title",
  "label",
  "records", // Collections, whose contents or member count imply existence.
  "items",
  "rows",
]);
type RedactionRule = (path: string) => boolean;
function lastSegment(path: string): string {
  const separator = path.lastIndexOf(".");
  return separator === -1 ? path : path.slice(separator + 1);
}
const DENIAL_RULE: RedactionRule = (path) => DENIAL_VALUE_KEYS.includes(lastSegment(path));
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function walk(value: unknown, rule: RedactionRule, seen: WeakSet<object>, path: string): unknown {
  if (typeof value === "function" || typeof value === "symbol") return REDACTED;
  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED;
    seen.add(value);
    const items: readonly unknown[] = value;
    const copy: unknown[] = [];
    for (const item of items) copy.push(walk(item, rule, seen, path));
    return copy;
  }
  if (!isPlainRecord(value)) return value;
  if (seen.has(value)) return REDACTED;
  seen.add(value);
  const entries: [string, unknown][] = [];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path.length === 0 ? key : `${path}.${key}`;
    entries.push([key, rule(entryPath) ? REDACTED : walk(entry, rule, seen, entryPath)]);
  }
  return Object.fromEntries(entries); // fromEntries, not bracket assignment: an own "__proto__" key parsed from a document must stay ordinary data instead of being taken as a prototype.
}
function redactWith<T>(value: T, rule: RedactionRule): T {
  try {
    return walk(value, rule, new WeakSet<object>(), "") as T;
  } catch {
    return value;
  }
}
/** Replaces the value of every key in `DENIAL_VALUE_KEYS`, at any depth, with `REDACTED`; every denial path applies this before an outcome leaves the service, so a denied read carries no value it must not disclose. */ export const redactDenial = <T>(value: T): T => redactWith(value, DENIAL_RULE);
