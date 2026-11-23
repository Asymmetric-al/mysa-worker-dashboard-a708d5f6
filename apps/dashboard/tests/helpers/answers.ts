/** The narrowing every domain and integration case shares: one owner for the eight-name outcome union, the four read-result kinds and the fixture lookups a case makes, so a case states what it proves rather than how to read an answer. */
import { expect } from "vitest";
import type { AccessDecision } from "@/modules/data-service/authorize";
import type { OperationOutcomeName } from "@/modules/data-service/envelope";
import { isOutcome, isReadResult, type DeniedOutcome, type MutationOutcome, type ReadResult, type UnavailableOutcome } from "@/modules/data-service/outcome";
/** One outcome of the closed eight, by name. */
export type OutcomeNamed<N extends OperationOutcomeName> = Extract<MutationOutcome, { readonly outcome: N }>;
/** Asserts the answer is one of the closed eight and states the name the case expected, then narrows it to that member. */
export function expectOutcome<N extends OperationOutcomeName>(outcome: MutationOutcome, name: N): OutcomeNamed<N> {
  expect(isOutcome(outcome), "every answer is one of the eight named outcomes").toBe(true);
  expect(outcome.outcome).toBe(name);
  if (outcome.outcome !== name) throw new Error(`The call was answered "${outcome.outcome}" rather than "${name}", so the case cannot go on as written.`);
  return outcome as OutcomeNamed<N>;
}
/** Asserts the answer is the named outcome of the closed eight, naming the change the case attempted, then narrows it to that member. */
export function expectOutcomeFor<N extends OperationOutcomeName>(outcome: MutationOutcome, name: N, what: string): OutcomeNamed<N> {
  expect(isOutcome(outcome), `${what} must answer with one of the eight named outcomes`).toBe(true);
  expect(outcome.outcome, `${what} must answer "${name}"`).toBe(name);
  if (outcome.outcome !== name) throw new Error(`${what} was answered "${outcome.outcome}" rather than "${name}", so the case cannot go on as written.`);
  return outcome as OutcomeNamed<N>;
}
/** Asserts a read answered with its envelope and hands the envelope on, so a refusal fails by name instead of reading as empty data. */
export function expectEnvelope<E>(result: ReadResult<E>, what: string): E {
  expect(isReadResult(result), `${what} must answer with a read result`).toBe(true);
  if (result.kind !== "envelope") throw new Error(`${what} was expected to answer with an envelope and answered "${result.kind}".`);
  return result.envelope;
}
/** Asserts a read was refused and hands the redacted denial on. */
export function expectDenial<T>(result: ReadResult<T>, what: string): DeniedOutcome {
  expect(isReadResult(result), `${what} must answer with a read result`).toBe(true);
  if (result.kind !== "denied") throw new Error(`${what} was expected to be refused and answered "${result.kind}".`);
  return result.denied;
}
/** Asserts a read answered with the source outage it is, and hands the outage on. */
export function expectOutage<T>(result: ReadResult<T>, what: string): UnavailableOutcome {
  expect(isReadResult(result), `${what} must answer with a read result`).toBe(true);
  if (result.kind !== "unavailable") throw new Error(`${what} was expected to answer with a source outage and answered "${result.kind}".`);
  return result.unavailable;
}
/** Hands a seeded or looked-up value on, failing by name where the fixture a case starts from is absent. */
export function required<T>(value: T | null | undefined, what: string): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(`The seeded world carries no ${what}, so this case cannot start from it.`);
  return value as NonNullable<T>; // Narrowed by the check above, which TypeScript cannot express through `T | null | undefined`.
}
/** The first item of a seeded list, failing by name where the list is empty. */
export const first = <T>(items: readonly T[], what: string): T => required(items.at(0), what);
/** The first item of a list whose named property is the stated value, failing by the name the case knows it by. */
export function firstWhere<T, K extends keyof T>(items: readonly T[] | undefined, key: K, value: T[K], what: string): T {
  const matched = items?.find((item) => item[key] === value);
  return required(matched, what);
}
/** Hands a value on, failing with the case's own sentence where the fixture it starts from is absent. */
export function requiredSaying<T>(value: T | null | undefined, sentence: string): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(sentence);
  return value as NonNullable<T>; // Narrowed by the check above, which TypeScript cannot express through `T | null | undefined`.
}
/** The first item of a list whose named property is the stated value, failing with the case's own sentence where it is absent. */
export function firstSaying<T, K extends keyof T>(items: readonly T[] | undefined, key: K, value: T[K], sentence: string): T {
  const matched = items?.find((item) => item[key] === value);
  return requiredSaying(matched, sentence);
}
/** Refuses the next step with the case's own sentence, typed so it can stand in the alternative of a ternary. */
export function throwing(sentence: string): never {
  throw new Error(sentence);
}
/** Asserts a permission question was refused and hands the redacted denial on. */
export function expectRefused(decision: AccessDecision, what: string): DeniedOutcome {
  expect(decision.allowed, `${what} must be refused`).toBe(false);
  if (decision.allowed) throw new Error(`${what} was granted, which is the permission this case refuses.`);
  return decision.denial;
}
/** Asserts a permission question was granted. */
export function expectGranted(decision: AccessDecision, what: string): void {
  expect(decision.allowed, `${what} must be granted`).toBe(true);
}
/** Asserts each named member of an object is absent, one at a time, so a failure names the member that leaked. */
export function expectMembersAbsent(value: object, members: readonly string[], what: string): void {
  for (const member of members) expect(Object.hasOwn(value, member), `${what} must not carry "${member}"`).toBe(false);
}
