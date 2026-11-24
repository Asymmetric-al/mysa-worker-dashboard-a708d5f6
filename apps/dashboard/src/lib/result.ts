/** Generic result helpers for service internals. */
/** A success value or a failure, tagged so `isOk` narrows it to one branch. */ export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
/** Wraps a success value; the error type is uninhabited until a caller unifies it. */ export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}
/** Wraps a failure; the value type is uninhabited until a caller unifies it. */ export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
/** The single narrowing predicate for a `Result`; callers negate it instead of using a second helper. */ export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}
/** Proves a closed union was handled exhaustively: a `switch` that misses a member fails to compile at this call, and a value that reaches it any other way is reported rather than ignored. */
export function assertNever(value: never, message?: string): never {
  throw new Error(`${message ?? "Unexpected variant"}: ${String(value)}`);
}
