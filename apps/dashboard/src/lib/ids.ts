/**
 * Attempt and reference identity helpers.
 *
 * Two unrelated kinds of identity live here and must never be conflated. An
 * `operationId` names one attempt at one mutation, so replaying it is a replay
 * the service answers by identity rather than a second effect. A
 * `SourceReference` names a record another system owns, opaquely.
 */

/**
 * An opaque, source-qualified reference to a record owned by another system.
 *
 * Both members are opaque. `reference` is never parsed, never compared across
 * systems and never used as a join key; `system` names the owner that issued it.
 * Equal-looking references from different systems are different identities, and
 * a matching name, email address or postal address is never evidence that two
 * records are one. Identity is established by the source pair alone, through
 * `sameSourceReference`.
 */
export type SourceReference = {
  readonly system: string;
  readonly reference: string;
};

/**
 * Mints the identity of one mutation attempt, as a canonical lowercase UUID v4.
 *
 * The mutation input (`{ operationId, scope, expectedRevision, payload }`) is
 * built in the browser as well as on the server, so this reads the Web Crypto
 * global instead of importing a Node-only crypto module, which would pull a Node
 * built-in into the client bundle. `globalThis.crypto.randomUUID()` exists in
 * Node 26, Bun 1.4.5, modern browsers in a secure context (localhost included)
 * and Vitest.
 *
 * The value is random and caller-generated on purpose: never derived from the
 * payload, a seed, a timestamp or a counter, never reused across attempts and
 * never persisted here. Replaying an `operationId` returns the stored result
 * (`alreadyAccepted`) instead of applying a second effect, and an uncertain
 * outcome is recovered by re-querying that same identity — uncertainty is never
 * turned into a resend.
 */
export function newOperationId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Formats a source reference for display and diagnostics only.
 *
 * The `system:reference` string it returns is never parsed back, never used as
 * an equality key and never a join key — `sameSourceReference` is the only
 * permitted comparison. Formatting inside `reference` survives exactly, so a
 * leading zero is displayed rather than numerically normalised away.
 */
export function formatSourceReference(reference: SourceReference): string {
  return `${reference.system}:${reference.reference}`;
}

/**
 * Reports whether two references denote the same record in the same source.
 *
 * Exact string equality on both members: an identity check, not a fuzzy match.
 * Two references from different systems are different identities even when their
 * `reference` strings look identical, and equal display names, email addresses or
 * postal addresses never make two records the same.
 */
export function sameSourceReference(a: SourceReference, b: SourceReference): boolean {
  return a.system === b.system && a.reference === b.reference;
}
