/**
 * Key-driven redaction for diagnostics and for every denial path.
 *
 * Two invariants are protected here, and nothing else is.
 *
 * A `denied` outcome reveals nothing about a hidden record: no existence flag, no
 * count, no title and no size, so search, sorting and pagination cannot be used as
 * a disclosure oracle. Authorisation itself happens before enumeration, in
 * `modules/data-service/authorize.ts`; this module makes sure a decision already
 * made cannot leak through the shape of what leaves the service.
 *
 * Private note bodies, check-in text, message bodies, email addresses and gift
 * amounts never appear in a diagnostic or in an error surface.
 *
 * Redaction only removes and replaces values. It never validates, authorises or
 * decides what a caller may see, and it holds no access matrix: the caller names
 * the keys or the paths its purpose forbids, and each matched value becomes the
 * single marker `REDACTED`, which stays recognisable in a diagnostic and
 * distinguishable from an empty string.
 *
 * The two key lists are deliberately separate because they mean different things.
 * Collapsing them would redact a legitimate title on a permitted read and would
 * stop the denial path from covering counts, so each purpose keeps its own list.
 *
 * No module directive is declared, so the service, a Route Handler and a Client
 * Component's error surface can all import this module. It imports one helper, the
 * `isRecord` guard, and reads no clock, prints nothing and never throws: a
 * redaction failure must never break the operation it is protecting, so a
 * structure that cannot be walked is returned unchanged.
 */

import { isRecord } from "@/lib/guards";

/**
 * The single replacement marker, so a redacted cell is recognisable in a
 * diagnostic and distinguishable from an empty string.
 */
export const REDACTED = "[redacted]";

/**
 * The key names whose values must never reach a logger or an error surface,
 * grouped by the category that forbids them:
 *
 * - private note bodies: `note`, `body`, `noteBody`
 * - check-in text: `answers`, `questions`, `checkInText`
 * - message bodies: `subject`, `html`, `text`, `messageBody`
 * - email addresses: `email`, `emailAddress`, `contactValue`, plus the contact
 *   method collection and its single-method form (`contactMethods`,
 *   `contactMethod`) — the address lives in a nested member of that collection, so
 *   redacting the collection by key is the only mechanical way to be sure none
 *   survives whatever the nested member is named
 * - gift amounts: `amount`, `amountMinor`, `minorUnits`, `amounts`, `totals`
 * - exported rows: `rows`, `exportRows`
 *
 * Matching is by key name at any depth, and a matched value is replaced whole, so
 * nothing under it is walked for the values it contains. The list is frozen
 * because a caller that widened it at runtime would silently change what every
 * logger in the application discloses.
 */
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
]);

/**
 * The key names a `denied` outcome must never reveal, grouped by the evidence the
 * denial has to withhold:
 *
 * - existence and size: `exists`, `count`, `size`, `bytes`, `length`, `total`,
 *   `totalCount`
 * - identity and title: `id`, `ids`, `name`, `title`, `label`
 * - the collections themselves: `records`, `items`, `rows` — a member count or a
 *   member is evidence of existence even when no field of it is shown
 *
 * These are separate from `SENSITIVE_VALUE_KEYS` on purpose. A permitted read may
 * render a title, a name or an identifier, and a diagnostic may record a count;
 * only a denial has to withhold all of them, because there the value's very
 * presence answers a question the caller may not ask. Frozen for the same reason
 * as the sensitive list.
 */
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

/**
 * Decides, for one position in the walk, whether its value is replaced; `path` is
 * the dot-notation path of that position from the walked root.
 */
type RedactionRule = (path: string) => boolean;

/** The final path segment, which is the key name the position was reached under. */
function lastSegment(path: string): string {
  const separator = path.lastIndexOf(".");
  return separator === -1 ? path : path.slice(separator + 1);
}

/**
 * Matches by key name at any depth, which is how `stripSensitiveValues` and
 * `redactDenial` apply their list: a sensitive or denied key is recognised
 * wherever in the structure it appears, not only at the root.
 */
function keyRule(keys: readonly string[]): RedactionRule {
  return (path) => keys.includes(lastSegment(path));
}

/**
 * Matches the exact dot-notation paths the caller named, so `redactPaths` can
 * withhold `note.body` or `amount.minorUnits` without withholding the rest of the
 * record. A path naming a position that is not present simply never matches.
 */
function pathRule(paths: readonly string[]): RedactionRule {
  const named = paths.filter((path) => path.length > 0);
  return (path) => named.includes(path);
}

const SENSITIVE_RULE = keyRule(SENSITIVE_VALUE_KEYS);
const DENIAL_RULE = keyRule(DENIAL_VALUE_KEYS);

/**
 * Narrows to a plain record — an object literal or an `Object.create(null)`
 * result. `isRecord` alone would also admit a `Date`, a `Map` or a class instance,
 * and those are copied by reference rather than walked, so their prototype is the
 * test that decides it.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The one traversal every redaction performs.
 *
 * Plain records are copied key by key and arrays element by element, so the result
 * has the same shape as the input and the input is never touched. Array elements do
 * not add a path segment: a path such as `rows.amount.minorUnits` applies at the
 * same position inside every element of `rows`, which is what a caller means when
 * it names a field of a row.
 *
 * `seen` carries the objects already walked. A reference met a second time — a
 * cycle, or the same object reached down two branches — becomes `REDACTED` rather
 * than being walked again, so a circular structure terminates instead of looping.
 * A `Date`, a `Map`, a class instance or any other non-plain object is copied by
 * reference because it cannot be redacted field by field, and a function or symbol
 * is replaced with `REDACTED` because it cannot be rendered safely at all.
 */
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
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = path.length === 0 ? key : `${path}.${key}`;
    copy[key] = rule(entryPath) ? REDACTED : walk(entry, rule, seen, entryPath);
  }
  return copy;
}

/**
 * Runs one redaction pass over a fresh walk and answers with the caller's shape.
 *
 * The module's single type assertion sits here: the walk preserves the structure it
 * was given — the same keys in the same positions, arrays still arrays — so its
 * result has the caller's type, and redaction only ever removes information.
 *
 * A walk that fails — a getter or a proxy trap that throws, an exotic value that
 * cannot be read — answers with the caller's value unchanged rather than
 * propagating the failure, because a redaction must never break the operation it is
 * protecting.
 */
function redactWith<T>(value: T, rule: RedactionRule): T {
  try {
    return walk(value, rule, new WeakSet<object>(), "") as T;
  } catch {
    return value;
  }
}

/**
 * Replaces each named dot-notation path with `REDACTED`, for a caller that knows
 * exactly which fields its diagnostic or error surface must not carry (for example
 * `"note.body"` or `"amount.minorUnits"`). A path that is not present is ignored;
 * the input is returned as a copy and is never mutated.
 */
export function redactPaths<T>(value: T, paths: readonly string[]): T {
  return redactWith(value, pathRule(paths));
}

/**
 * Replaces the value of every key in `SENSITIVE_VALUE_KEYS`, at any depth, with
 * `REDACTED`, so a logger or an error surface carries no private note body,
 * check-in text, message body, email address or gift amount. The input is returned
 * as a copy and is never mutated.
 */
export function stripSensitiveValues<T>(value: T): T {
  return redactWith(value, SENSITIVE_RULE);
}

/**
 * Replaces the value of every key in `DENIAL_VALUE_KEYS`, at any depth, with
 * `REDACTED`; every denial path applies this before an outcome leaves the service,
 * so a denied read carries no existence flag, count, title or size of a hidden
 * record. The input is returned as a copy and is never mutated.
 */
export function redactDenial<T>(value: T): T {
  return redactWith(value, DENIAL_RULE);
}
