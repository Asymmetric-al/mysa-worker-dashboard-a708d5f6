/**
 * `GET /api/preferences` and `POST /api/preferences` — the reader's own choice for one publisher and
 * one purpose, the reading language that stands beside it, and the state of the membership behind them.
 */
import type { NextRequest } from "next/server";
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store reads and writes session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The session, the membership and the scenario instant are resolved per request, so no cache may hold this answer across a persona switch or a consent change. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_ID = "read";

const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

const MESSAGES = {
  unadmittedParameter: "A preference is the reading session's own, so this read takes no parameters: a reader, membership, address or persona is never selected by the request.",
  membershipRequired: "A preference change names the membership it records a choice against, so open the preferences this session reads and choose again.",
  membershipTooLong: "That reference is too long to be one membership, so reopen the preferences this session reads rather than pasting a value.",
  choiceClosed: "The choice is closed to off and immediate, the two decisions this purpose offers; a further value would be a separate consent this release does not keep.",
  languageInvalid: "Use a language tag such as en-GB or ar, of 35 characters or fewer.",
} as const;

type PreferencePayload = Parameters<typeof mutations.audience.setPreference>[0]["payload"];

type PreferenceChoice = PreferencePayload["choice"];

const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;

const CHOICE_MEMBERS = ["off", "immediate"] as const satisfies readonly PreferenceChoice[];

// The membership names the publisher and the purpose it was opened for, so this payload carries no
// second copy of either. The choice set is closed and this handler admits no third value and no
// cadence: a decision this surface does not record is refused by name rather than carried onward.
const preferencePayloadSchema = z.strictObject({
  membershipId: z.string({ error: MESSAGES.membershipRequired }).min(1, MESSAGES.membershipRequired).max(200, MESSAGES.membershipTooLong),
  choice: z.enum(CHOICE_MEMBERS, { error: MESSAGES.choiceClosed }),
  languagePreference: z.string({ error: MESSAGES.languageInvalid }).max(35, MESSAGES.languageInvalid).regex(LANGUAGE_TAG_SHAPE, MESSAGES.languageInvalid).optional(),
});

const preferenceBodySchema = mutationInputSchema(preferencePayloadSchema);

// This read answers for the session that asks it and declares no parameter, so every name a request
// carries is refused by name rather than ignored: an address, a membership or a persona in the query
// would otherwise read as a selector the session never granted, and an address is never a key a record
// is found by.
const preferenceQuerySchema = z.record(z.string(), z.string()).superRefine((claimed, ctx) => {
  for (const name of Object.keys(claimed)) {
    ctx.addIssue({ code: "custom", message: MESSAGES.unadmittedParameter, path: [name] });
  }
});

function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = Reflect.get(body, "operationId");
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}
/** Answers with the reader's own Off or Immediate choice, reading language, membership state and proof state as four separate facts inside the one read envelope, and confirms nothing. */
export async function GET(request: NextRequest): Promise<Response> {
  const claimed = preferenceQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!claimed.success) {
    // A parameter this read does not admit is a request-level refusal, answered with the same
    // per-field `invalid` outcome a mutation answers, because no source behind the read failed.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, claimed.error));
  }
  try {
    return toResponse(await reads.audience.readPreferences());
  } catch (error) {
    // A read answers its own refusals as results, so a throw here is a store or medium fault, or a
    // failure whose fate is not known, and the one mapper names which.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}
/** Records the caller's Off or Immediate choice, plus a reading language when the body states one, and answers with exactly one of the service's eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function POST(request: NextRequest): Promise<Response> {
  const body: unknown = await request.json().catch(() => undefined);
  const parsed = preferenceBodySchema.safeParse(body);
  if (!parsed.success) {
    // The body states the attempt, so its own operation id is the one reported. This handler never
    // mints or rewrites an operation id: replay identity belongs to the caller, and a fresh identity
    // is exactly the second effect a lost acknowledgement must not produce.
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    // The service owns the whole decision: it resolves scope from the development session, checks the
    // expected revision, records the choice, and answers replay, no-change and staleness itself.
    return toResponse(await mutations.audience.setPreference(parsed.data));
  } catch (error) {
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
