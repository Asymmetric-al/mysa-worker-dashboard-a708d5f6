/**
 * `GET /api/partners/[partnerId]` — one partner's record body: identity and the contact methods this
 * caller may use, restrictions, relationship context, open work and the authorised support history,
 * the activity that actually happened, and — where the caller wrote it — their own private
 * preparation, folded into the one read envelope every browser read answers with.
 */
import { outcomeFromError, reads, toResponse, type Coverage, type ReadAction, type ReadEnvelope, type ValueState } from "@/modules/data-service";
/** The store keeps session documents on the local filesystem, so this handler is never an edge one. */
export const runtime = "nodejs";
/** Scope comes from the session cookie and every boundary is judged at the scenario clock of this request, so no answer may be served from a cache across a context switch. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

interface PartnerRecordParams {
  readonly partnerId: string;
}
/** How complete each coverage state is, so a folded record states the least complete section it carries instead of an upgraded one. */
const COVERAGE_RANK: Readonly<Record<Coverage["state"], number>> = { complete: 0, partial: 1, unknown: 2 };
/** Answers with the record body folded into one envelope, or the read's own `denied` or `unavailable` refusal, or `unknown` when a fault leaves the answer's fate unclear. */
export async function GET(_request: Request, context: { params: Promise<PartnerRecordParams> }): Promise<Response> {
  try {
    // Next 16 hands a dynamic segment over as a promise. The value is opaque: it reaches the read
    // exactly as it arrived and is never decoded, parsed, matched against a name or an address, or
    // treated as a path.
    const { partnerId } = await context.params;
    const partner = await reads.partners.readPartner(partnerId);
    if (partner.kind !== "envelope") {
      // The record itself is refused, so nothing further is read: a denied record must not even
      // reveal that another section of it could have been fetched.
      return toResponse(partner);
    }
    const interactions = await reads.interactions.readInteractions({ partnerId });
    if (interactions.kind !== "envelope") {
      // The record body and the activity it carries are one authority: a history that is unavailable
      // is an outage rather than an empty past, and a denied one is not a section to omit quietly.
      return toResponse(interactions);
    }
    const preparation = await reads.partners.readPrivatePreparation({ partnerId });
    if (preparation.kind === "unavailable") {
      // A source that did not answer is not "you wrote nothing", so the record says the private
      // preparation could not be read rather than presenting an empty one.
      return toResponse(preparation);
    }
    const sections = [partner.envelope, interactions.envelope, ...(preparation.kind === "envelope" ? [preparation.envelope] : [])];
    let asOf = partner.envelope.asOf;
    let coverageState = partner.envelope.coverage.state;
    const valueStates: Record<string, ValueState> = {};
    const actions: ReadAction[] = [];
    const actionNames = new Set<string>();
    for (const section of sections) {
      // Every read in one request shares `time/clock.ts` `now()` and states it in the UTC form
      // `Temporal.Instant.toString()` produces, so the latest instant is the greatest of them and the
      // record never claims an earlier instant than the data it carries.
      if (section.asOf > asOf) {
        asOf = section.asOf;
      }
      if (COVERAGE_RANK[section.coverage.state] > COVERAGE_RANK[coverageState]) {
        coverageState = section.coverage.state;
      }
      // The first section to state a path owns it, and the record's own fields are folded first, so
      // each value keeps the state its own read recorded. No path is added here and none is dropped,
      // which is what lets a genuine zero, an unknown, a withheld value and an unavailable source stay
      // four different renderings rather than one number.
      for (const [path, state] of Object.entries(section.valueStates)) {
        if (valueStates[path] === undefined) {
          valueStates[path] = state;
        }
      }
      // Available actions are advisory — the service re-checks on submit — so a repeated name keeps
      // the record's own entry and its reason, and a stale envelope can never authorise a write.
      for (const action of section.actions) {
        if (actionNames.has(action.name)) {
          continue;
        }
        actionNames.add(action.name);
        actions.push(action);
      }
    }
    // A worker-private record the caller did not write is absent from the body — not `null`, not an
    // empty object — because even its existence is something this caller may not learn.
    const data = {
      partner: partner.envelope.data,
      interactions: interactions.envelope.data,
      ...(preparation.kind === "envelope" ? { privatePreparation: preparation.envelope.data } : {}),
    };
    const envelope: ReadEnvelope<typeof data> = {
      data,
      scope: partner.envelope.scope,
      source: partner.envelope.source,
      // The record's own revision, because that is what a later `POST …/edits` echoes back as the
      // revision the caller read.
      revision: partner.envelope.revision,
      asOf,
      // The record's own period bounds, with the least complete state among the sections folded into
      // it, so a record carrying a partly covered section never reads as a complete one.
      coverage: { from: partner.envelope.coverage.from, to: partner.envelope.coverage.to, state: coverageState },
      valueStates,
      actions,
    };
    return toResponse({ kind: "envelope", envelope });
  } catch (error) {
    // A throw here is a defect rather than a presentation: the service answers refusals as outcomes, so
    // a throw means a store or medium fault, or a failure whose fate is not known. A read attempted no
    // effect, so the outcome carries the marker rather than a fabricated operation id.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
