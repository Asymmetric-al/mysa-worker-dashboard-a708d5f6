/**
 * Key-driven redaction for diagnostics and for every denial path.
 */
import { isRecord } from "@/lib/guards";
/** The single replacement marker, so a redacted cell is recognisable in a diagnostic and distinguishable from an empty string. */
export const REDACTED = "[redacted]";
/** The key names whose values must never reach a logger or an error surface, grouped by the category that forbids them: */
export const SENSITIVE_VALUE_KEYS: readonly string[] = Object.freeze([
  // Private note bodies.
  "note",
  "body",
  "noteBody",
  // Check-in text.
  "answers",
  "questions",
  "checkInText",
  // Message bodies.
  "subject",
  "html",
  "text",
  "messageBody",
  // Email addresses, and the collections an address is carried inside.
  "email",
  "emailAddress",
  "contactValue",
  "contactMethod",
  "contactMethods",
  // Gift amounts.
  "amount",
  "amountMinor",
  "minorUnits",
  "amounts",
  "totals",
  // Exported rows.
  "rows",
  "exportRows",
  // The development session credential, which is the httpOnly cookie's value.
  "sessionId",
  "dashboard_session",
]);
/** The key names a `denied` outcome must never reveal, grouped by the evidence the denial has to withhold: */
export const DENIAL_VALUE_KEYS: readonly string[] = Object.freeze([
  // Existence and size evidence.
  "exists",
  "count",
  "size",
  "bytes",
  "length",
  "total",
  "totalCount",
  // Identity and title evidence.
  "id",
  "ids",
  "name",
  "title",
  "label",
  // Collections, whose contents or member count imply existence.
  "records",
  "items",
  "rows",
]);
type RedactionRule = (path: string) => boolean;

function lastSegment(path: string): string {
  const separator = path.lastIndexOf(".");
  return separator === -1 ? path : path.slice(separator + 1);
}
function keyRule(keys: readonly string[]): RedactionRule {
  return (path) => keys.includes(lastSegment(path));
}
function pathRule(paths: readonly string[]): RedactionRule {
  const named = paths.filter((path) => path.length > 0);
  return (path) => named.includes(path);
}
const SENSITIVE_RULE = keyRule(SENSITIVE_VALUE_KEYS);
const DENIAL_RULE = keyRule(DENIAL_VALUE_KEYS);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function walk(value: unknown, rule: RedactionRule, seen: WeakSet<object>, path: string): unknown {
  if (typeof value === "function" || typeof value === "symbol") {
    return REDACTED;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return REDACTED;
    }
    seen.add(value);
    const items: readonly unknown[] = value;
    const copy: unknown[] = [];
    for (const item of items) {
      copy.push(walk(item, rule, seen, path));
    }
    return copy;
  }
  if (!isPlainRecord(value)) {
    return value;
  }
  if (seen.has(value)) {
    return REDACTED;
  }
  seen.add(value);
  const entries: [string, unknown][] = [];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path.length === 0 ? key : `${path}.${key}`;
    entries.push([key, rule(entryPath) ? REDACTED : walk(entry, rule, seen, entryPath)]);
  }
  // fromEntries, not bracket assignment: an own "__proto__" key parsed from a document
  // must stay ordinary data instead of being taken as a prototype.
  return Object.fromEntries(entries);
}
function redactWith<T>(value: T, rule: RedactionRule): T {
  try {
    return walk(value, rule, new WeakSet<object>(), "") as T;
  } catch {
    return value;
  }
}
/** Replaces each named dot-notation path with `REDACTED`, for a caller that knows exactly which fields its diagnostic or error surface must not carry (for example `"note.body"` or. */
export function redactPaths<T>(value: T, paths: readonly string[]): T {
  return redactWith(value, pathRule(paths));
}
/** Replaces the value of every key in `SENSITIVE_VALUE_KEYS`, at any depth, with `REDACTED`, so a logger or an error surface carries no private note body, check-in text, message body, email. */
export function stripSensitiveValues<T>(value: T): T {
  return redactWith(value, SENSITIVE_RULE);
}
/** Replaces the value of every key in `DENIAL_VALUE_KEYS`, at any depth, with `REDACTED`; every denial path applies this before an outcome leaves the service, so a denied read carries no. */
export function redactDenial<T>(value: T): T {
  return redactWith(value, DENIAL_RULE);
}
