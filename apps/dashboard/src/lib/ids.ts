/**
 * Attempt and reference identity helpers.
 */
/**
 * An opaque, source-qualified reference to a record owned by another system.
 */
export type SourceReference = {
  readonly system: string;
  readonly reference: string;
};
/** Mints the identity of one mutation attempt, as a canonical lowercase UUID v4. */
export function newOperationId(): string {
  return globalThis.crypto.randomUUID();
}
/** Formats a source reference for display and diagnostics only. */
export function formatSourceReference(reference: SourceReference): string {
  return `${reference.system}:${reference.reference}`;
}
/** Reports whether two references denote the same record in the same source. */
export function sameSourceReference(a: SourceReference, b: SourceReference): boolean {
  return a.system === b.system && a.reference === b.reference;
}
