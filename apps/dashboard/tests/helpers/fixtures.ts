/** The fixture plumbing every domain and integration case shares: the seeded world, the session a case acts in, the context that session selected, the documents the store holds under it, and the coaching target scaffolding read from a seeded record, so a case states the world it starts from in one line. */
import { Temporal } from "temporal-polyfill";
import type { CoachingTargetRecord } from "@/modules/data-service";
import { resolveSession, type ResolvedSession, type SessionSource } from "@/modules/data-service/authorize";
import { resolvePeriodContaining, type PeriodAnchor, type ResolvedPeriod, type TargetPeriod, type TargetRecord, type TargetVersion } from "@/modules/coaching/target";
import type { Scope } from "@/modules/data-service/envelope";
import { seed, type SeededSessionDocuments, type SeededSessionWithDocuments, type SessionStateDocument } from "@/modules/dev-runtime/seed";
import { readSession, resetSession } from "@/modules/store/repository";
import { firstSaying, requiredSaying } from "./answers";
let seededWorld: Promise<readonly SeededSessionWithDocuments[]> | undefined;
/** One build of the seeded world for the whole suite: the documents are deterministic, so a file that lays a session down again before every case starts from exactly the same bytes. */
export function seededSessions(): Promise<readonly SeededSessionWithDocuments[]> {
  seededWorld ??= seed();
  return seededWorld;
}
/** The documents the seed lays down under one of its own session ids, failing by name where it lays down none. */
export const seededDocuments = async (seedId: string): Promise<SeededSessionDocuments> => firstSaying(await seededSessions(), "sessionId", seedId, `The seed lays down no "${seedId}" workspace, so no case here has a world to start from`).documents;
/** Lays a seeded world down under a session id a file owns, with that session's own id written into the record set it holds rather than naming a session that is not the one reading it. */
export async function layDownSeededSession(sessionId: string, seedId: string): Promise<void> {
  const documents = await seededDocuments(seedId);
  await resetSession(sessionId, { ...documents, state: { ...documents.state, context: { ...documents.state.context, sessionId } } });
}
/** The session a source resolves to, resolved by the service's own resolver rather than assembled here. */
export async function sessionOf(source: SessionSource): Promise<ResolvedSession> {
  const resolution = await resolveSession(source);
  if (!resolution.ok) throw new Error(`The session "${source.sessionId}" could not be resolved, so no case can act as it: ${JSON.stringify(resolution.refusal)}`);
  return resolution.session;
}
/** The context a source's session selected, which is the authority every read and write below acts under. */
export const scopeOf = async (source: SessionSource): Promise<Scope> => requiredSaying((await sessionOf(source)).selected, `The session "${source.sessionId}" has selected no context, so it holds no scope to act in`);
/** The state the store holds under a session id, named as the shape the seed wrote rather than read through a cast at each use. */
export async function storedStateOf(sessionId: string): Promise<SessionStateDocument> {
  const documents = await readSession(sessionId);
  return requiredSaying(documents?.state as SessionStateDocument | undefined, `The store holds no session "${sessionId}", so no case here can read the world it asserts about`);
}
/** The period a stored target states, converted to the domain's own period rather than cast. */
export function targetPeriodOf(record: CoachingTargetRecord): TargetPeriod {
  const { period } = record;
  switch (period.kind) {
    case "weekly":
      return { kind: "weekly" };
    case "monthly":
      return { kind: "monthly" };
    case "custom":
      return {
        kind: "custom",
        start: Temporal.PlainDate.from(requiredSaying(period.from ?? undefined, "A seeded one-off custom period states both its first and its last day.")),
        end: Temporal.PlainDate.from(requiredSaying(period.to ?? undefined, "A seeded one-off custom period states both its first and its last day.")),
      };
    default:
      throw new Error(`The seeded target states a period this suite does not know: ${String(period.kind)}`);
  }
}
/** The anchor a stored target's period is resolved against. */
export const anchorOf = (record: CoachingTargetRecord): PeriodAnchor => ({ period: targetPeriodOf(record), calendarStart: Temporal.PlainDate.from(record.calendarStart) });
/** The version history a stored target carries, with each effective date as a civil date. */
export function versionsOf(record: CoachingTargetRecord): readonly TargetVersion[] {
  return record.versions.map((version) => ({
    revisionId: version.revisionId,
    effectiveFrom: Temporal.PlainDate.from(version.effectiveFrom),
    ...(version.effectiveTo === null ? {} : { effectiveTo: Temporal.PlainDate.from(version.effectiveTo) }),
    quantity: version.quantity,
    measure: version.measure,
    calendarStart: Temporal.PlainDate.from(version.calendarStart),
  }));
}
/** The target record the domain functions measure against, from the record the seed stored. */
export function targetRecordOf(record: CoachingTargetRecord): TargetRecord {
  return { targetId: record.targetId, privateLabel: record.privateLabel, measure: record.measure, quantity: record.quantity, period: targetPeriodOf(record), calendarStart: Temporal.PlainDate.from(record.calendarStart), homePlacement: record.homePlacement, state: record.state, versions: versionsOf(record) };
}
/** The period a stored target's anchor resolves for one civil day. */
export function weekOf(record: CoachingTargetRecord, date: Temporal.PlainDate): ResolvedPeriod {
  const period = resolvePeriodContaining(anchorOf(record), date);
  if (!period.ok) throw new Error(`The period containing ${date.toString()} did not resolve: ${JSON.stringify(period.error)}`);
  return period.value;
}
