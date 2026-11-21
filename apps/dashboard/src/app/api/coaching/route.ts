/** `GET /api/coaching` — the worker's own coaching overview — and `POST /api/coaching`, the one invitation this path issues: a coach named by identifier, the organization and ministry it is made in … */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, refusedRead, toResponse } from "@/modules/data-service";
import { UNIDENTIFIED_ATTEMPT, jsonBodyOf, operationIdentityOf } from "../handler";
/** The store reads and writes session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** Both verbs resolve the development session and evaluate the scenario clock once per request, so a read at a grant's frozen cutoff is denied in the same request rather than served from a cache. */
export const dynamic = "force-dynamic";
const READ_ATTEMPT_ID = "read";
const UNATTEMPTED_REQUEST_ID = "no-operation-attempted";
const MESSAGES = {
  body: "Send the invitation as a JSON object carrying operationId, the scope it claims, the revision it read and its payload.",
  reference: "Name the coach, the organization and the ministry by the opaque identifier this application uses. An email address, a name, a job title or a postal address establishes neither identity nor authority, so a value of that kind invites nobody.",
  duration: "An invitation states the duration it is made for: an ongoing relationship, or a share-through date. A missing duration is not permission — it would leave the coach's access open-ended — so the request is refused rather than read as ongoing.",
  durationKind: "An invitation's duration is either an ongoing relationship, or shared through a stated date written as YYYY-MM-DD.",
  throughDate: "Write the share-through date as a real calendar day in the stored form YYYY-MM-DD, so the cutoff it freezes falls on a day that exists.",
  module: "Every module begins unselected: an invitation names the five modules this relationship may later disclose and grants none of them itself, so a module offered as already selected is refused rather than quietly recorded as unshared.",
  range: "A reviewed range is the fixed period reviewed for financial sharing. It states two real calendar days in the stored form YYYY-MM-DD, and optionally the one currency its figures were reviewed in.",
  rangeOrder: "A reviewed range ends on or after the day it starts, so the period it states contains a day.",
  coach: "An invitation names the coach it is for, by identifier. An invitation with no recipient can be accepted by nobody, so it would sit in the relationship list unnamed.",
  ministry: "An invitation names, by identifier, the ministry it is made in, so a coach reads only the ministry the worker chose to share.",
} as const;
const SCOPE_SELECTION_REFUSED =
  "The coaching overview is read in the session's own scope: the organization, ministry, support subject, principal, coach and grant all come from the development session, and none of them is chosen by the request. A parameter that names one is refused rather than dropped, because a caller whose parameter was silently discarded would read the session's context believing it had chosen another.";
/** The query parameters that would name the authority a read runs under. */
const SCOPE_SELECTING_PARAMETERS = ["principal", "principalId", "persona", "session", "sessionId", "organization", "organizationId", "orgId", "ministry", "ministryId", "supportSubject", "supportSubjectId", "coach", "coachId", "coachPrincipalId", "grant", "grantId", "scope"] as const;
const opaqueReference = z.string({ error: MESSAGES.reference }).trim().min(1, MESSAGES.reference);
/** The closed set of modules an invitation names, each at `false`. */
const invitedModules = z.strictObject({
  "support-goal": z.literal(false, { error: MESSAGES.module }),
  "support-results": z.literal(false, { error: MESSAGES.module }),
  targets: z.literal(false, { error: MESSAGES.module }),
  "check-ins": z.literal(false, { error: MESSAGES.module }),
  "task-summaries": z.literal(false, { error: MESSAGES.module }),
});
const shareDuration = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("ongoing") }), z.strictObject({ kind: z.literal("through-date"), shareThroughDate: z.iso.date({ error: MESSAGES.throughDate }) })], { error: MESSAGES.durationKind });
/** The duration is required, and its absence is told as a missing duration rather than as a type fault at an unnamed field. */
const durationField = z.custom<unknown>((stated) => stated !== undefined && stated !== null, { error: MESSAGES.duration }).pipe(shareDuration);
const reviewedRange = z
  .strictObject({ fromDate: z.iso.date({ error: MESSAGES.range }), toDate: z.iso.date({ error: MESSAGES.range }), currency: z.string({ error: MESSAGES.range }).trim().min(1, MESSAGES.range).optional() })
  .refine((range) => range.fromDate <= range.toDate, { path: ["toDate"], message: MESSAGES.rangeOrder });
/** What one invitation states, and nothing else. */
const invitationPayload = z
  .strictObject({
    coachPrincipalId: opaqueReference.optional(),
    recipientPrincipalId: opaqueReference.optional(),
    organizationId: opaqueReference,
    ministryId: opaqueReference.optional(),
    ministryIds: z.array(opaqueReference).min(1, MESSAGES.ministry).optional(),
    modules: invitedModules.optional(),
    duration: durationField,
    financialRange: reviewedRange.optional(),
  })
  .superRefine((payload, context) => {
    if (payload.coachPrincipalId === undefined && payload.recipientPrincipalId === undefined) {
      context.addIssue({ code: "custom", path: ["coachPrincipalId"], message: MESSAGES.coach });
    }
    if (payload.ministryId === undefined && payload.ministryIds === undefined) {
      context.addIssue({ code: "custom", path: ["ministryIds"], message: MESSAGES.ministry });
    }
  });
const inviteCoachRequest = mutationInputSchema(invitationPayload);
const jsonObjectBody = z.record(z.string(), z.unknown(), { error: MESSAGES.body });
function scopeSelectionRefusal(request: NextRequest): Response | undefined {
  const search = new URL(request.url).searchParams;
  for (const name of SCOPE_SELECTING_PARAMETERS) {
    if (!search.has(name)) {
      continue;
    }
    return toResponse(refusedRead(READ_ATTEMPT_ID, { [name]: [SCOPE_SELECTION_REFUSED] }));
  }
  return undefined;
}
/** This path's refusals have always been echoed under its own `no-operation-attempted` marker rather than the shared placeholder, so a caller's recovery is matched against the identity it already has; only that marker stays here, while the rule that reads the attempt the body claims is the shared one. */
function refusalIdentityOf(raw: unknown): string {
  const claimed = operationIdentityOf(raw);
  return claimed === UNIDENTIFIED_ATTEMPT ? UNATTEMPTED_REQUEST_ID : claimed;
}
type ParsedBody = { readonly kind: "refused"; readonly response: Response } | { readonly kind: "ready"; readonly body: unknown };
/** Refuses a body that is not a JSON object before any field is judged, so malformed JSON is answered as `invalid` stating what a mutation body carries rather than as a thrown error or a bare 500. */
function parseBody(raw: unknown, operationId: string): ParsedBody {
  const claimed = jsonObjectBody.safeParse(raw);
  if (!claimed.success) {
    return { kind: "refused", response: toResponse(outcomeFromError(operationId, claimed.error)) };
  }
  return { kind: "ready", body: raw };
}
/** Answers with the worker's coaching overview — private preparation as its own record class, and every relationship's state, its five independent module switches, its duration and its separate outcomes — inside the read's envelope. Answers `envelope`, or the read's own refusal: `denied` when the caller may not read it and `unavailable` when the records cannot be read. */
export async function GET(request: NextRequest): Promise<Response> {
  const refused = scopeSelectionRefusal(request);
  if (refused !== undefined) {
    return refused;
  }
  try {
    return toResponse(await reads.coaching.readCoachingOverview());
  } catch (error) {
    // A read attempts no effect, so a thrown fault is answered under the read marker: the one mapper turns a store outage into `unavailable`, a session it cannot establish into `denied`, and an unrecognised failure into `unknown`, rather than letting it escape the boundary.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Issues one coaching invitation — the coach named by identifier, the organization and ministry it is made in, all five modules unselected and the duration it runs for — and answers with exactly one of `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const raw = await jsonBodyOf(request);
  const operationId = refusalIdentityOf(raw);
  const parsed = parseBody(raw, operationId);
  if (parsed.kind === "refused") {
    return parsed.response;
  }
  const invitation = inviteCoachRequest.safeParse(parsed.body);
  if (!invitation.success) {
    return toResponse(outcomeFromError(operationId, invitation.error));
  }
  try {
    // The scope the caller states is forwarded as it stands: the service checks it against the session's admissions and re-checks the scope the invitation produces, so no authority is decided here. A replay of the same operationId answers `alreadyAccepted` with the invitation already
    // issued, so a lost acknowledgement recovers rather than inviting twice.
    return toResponse(await mutations.coaching.inviteCoach(invitation.data));
  } catch (error) {
    return toResponse(outcomeFromError(invitation.data.operationId, error));
  }
}
