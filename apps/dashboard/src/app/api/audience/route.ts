/**
 * `GET /api/audience` — the publisher's audience for the one purpose this release keeps memberships
 * for — and `POST /api/audience`, the deliberate signup that opens the synthetic proof step.
 *
 * Scope, stated against the plan it implements:
 * - AAP 0.6.3, row `GET/POST /api/audience`: membership states, preference, unsubscribe and
 *   confirmation are the reader job, and confirmation never happens on `GET` or `HEAD`. This file is
 *   the `/api/audience` part of that row, and it carries exactly the two verbs the row names for it.
 * - AAP 0.7.1, job "Reach readers": of that job's reads and mutations this handler serves
 *   `readAudience` and `signupForPurpose` only. `setPreference` is `/api/preferences`, `unsubscribe` is
 *   `/api/unsubscribe`, the explicit confirmation is `/api/confirm` and `readInbox` is `/api/inbox`;
 *   none of them is re-implemented, proxied or stubbed here.
 * - AAP 0.8.5: membership state, communication consent, the reading language and protected reading are
 *   four separate facts. A signup opens one `awaiting-proof` membership and grants nothing: it reads no
 *   release, records no preference and subscribes nobody on an import or a contact edit.
 * - AAP 0.8.7: the confirmation window is 168 elapsed hours from acceptance, strict at equality, and it
 *   belongs to `confirmationDeadline` in `modules/time/window`. The deadline this handler returns is the
 *   service's; nothing here computes one, shortens one, extends one or accepts one from the client.
 * - AAP 0.9.1 and 0.11.1: a thin adapter over one named read and one named mutation, with no business
 *   logic, no second transport and no fetch of this application's own endpoints.
 *
 * Both verbs answer with the shared contract rather than a shape of their own: the read returns one
 * `ReadEnvelope` — scope, opaque source reference, revision, as-of, coverage, `valueStates` and the
 * actions available on the data — and the mutation returns exactly one of the eight outcomes. Nothing
 * here re-counts, re-sorts or flattens what the service produced.
 */
import { z } from "zod";
import { mutationInputSchema, mutations, outcomeFromError, reads, toResponse } from "@/modules/data-service";

/** The store behind the service reads and writes through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The read depends on the development session, the selected context and the scenario clock, so no envelope may be cached across a persona switch, a restriction or a clock change. */
export const dynamic = "force-dynamic";

/** The attempt a read that never reached a mutation reports under: a read makes no operation identity of its own. */
const READ_ATTEMPT_ID = "read";

/** The attempt reported when a body carried no usable `operationId`, so an `invalid` answer still names what it refused. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

// The read: the publisher's audience for the one purpose this release keeps memberships for
/** The query the audience read accepts, taken from the read itself so this handler cannot drift from it. */
type AudienceQuery = NonNullable<Parameters<typeof reads.audience.readAudience>[0]>;

const WHOLE_NUMBER_SHAPE = /^\d{1,9}$/;

function wholeNumber(message: string) {
  return z
    .string()
    .regex(WHOLE_NUMBER_SHAPE, message)
    .transform((value) => Number.parseInt(value, 10));
}

const audienceQuerySchema = z.strictObject({
  publisherId: z
    .string()
    .min(1, "Name the publisher whose audience to read, or omit it and the read answers for the single publisher of this session's Updates.")
    .max(200, "A publisher reference is at most 200 characters.")
    .optional(),
  page: wholeNumber("State the page as a whole number: pages start at 1, and a lower number is read as the first page.").optional(),
  pageSize: wholeNumber("State the page size as a whole number: the read answers 50 rows by default and caps at 200.").optional(),
});
type AudienceQueryParams = z.output<typeof audienceQuerySchema>;

/**
 * Reads only the three parameters the audience read declares. No address, membership, recipient,
 * principal or persona can be named on this path: the scope and the persona are resolved from the
 * development session inside the service, and the persona switcher is a development control rather
 * than an input to a read.
 */
function rawAudienceParams(search: URLSearchParams): Record<string, unknown> {
  return {
    publisherId: search.get("publisherId") ?? undefined,
    page: search.get("page") ?? undefined,
    pageSize: search.get("pageSize") ?? undefined,
  };
}

/** Forwards the parameters as the read declares them, omitting the ones the caller left out rather than stating an empty value the read would have to interpret. */
function audienceQueryOf(params: AudienceQueryParams): AudienceQuery {
  return {
    ...(params.publisherId === undefined ? {} : { publisherId: params.publisherId }),
    ...(params.page === undefined ? {} : { page: params.page }),
    ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
  };
}

/**
 * Answers with one envelope for the publisher's audience: the four membership states, the eligible and
 * excluded counts, every exclusion reason, and one page of members. The counts and the page totals carry
 * their `ValueState`, so a genuine zero, an unknown, a withheld value and an unavailable source stay four
 * different renderings; a source-supplied membership that is held or unqualified appears only inside the
 * excluded counts, never as an active member, because no state is decided here at all.
 */
export async function GET(request: Request): Promise<Response> {
  const params = audienceQuerySchema.safeParse(rawAudienceParams(new URL(request.url).searchParams));
  if (!params.success) {
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, params.error));
  }
  try {
    return toResponse(await reads.audience.readAudience(audienceQueryOf(params.data)));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers its refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known. The read attempted no
    // effect, so the outcome carries the read's marker rather than an operation id.
    return toResponse(outcomeFromError(READ_ATTEMPT_ID, error));
  }
}

// The write: the deliberate signup that opens the proof step and grants nothing
/** The mutation's own payload type, read from the mutation so this handler states no second vocabulary. */
type SignupInput = Parameters<typeof mutations.audience.signupForPurpose>[0];
type SignupPayload = SignupInput["payload"];

const LANGUAGE_TAG_SHAPE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/u;

const signupPayloadSchema = z.strictObject({
  publisherId: z.string().min(1, "A signup names the publisher whose Update email it asks for.").max(200, "A publisher reference is at most 200 characters."),
  // The purposes this release keeps memberships for are declared once, in the audience module, and the
  // service refuses any other with its own message. This field is checked for presence and size here and
  // typed from the mutation's payload, so the closed vocabulary is never listed a second time.
  purpose: z.custom<SignupPayload["purpose"]>((stated) => typeof stated === "string" && stated.length > 0 && stated.length <= 200, {
    error: "A signup states the communication purpose it asks for; the service names the purposes this release keeps memberships for and refuses any other.",
  }),
  // The address is a value the membership stores. Nothing here or behind it finds, merges or links a
  // record by it, and no handler may be given a way to look a reader up by it.
  email: z.email("This is not a complete email address. The address is stored as a value on the membership and is never used to find, merge or link a record."),
  displayName: z.string().min(1, "A display name is at least one character, or left out.").max(120, "A display name is at most 120 characters.").optional(),
  // The reading language stands on its own: it records no consent, proves no address and confirms nothing,
  // so a change of language subscribes nobody and completes no proof.
  languagePreference: z.string().regex(LANGUAGE_TAG_SHAPE, "A language preference is a BCP-47 tag such as en, fr-CA or ar.").max(35, "A language tag is at most 35 characters.").optional(),
});

/**
 * The one schema for this mutation: the shared four-field request envelope — operation id, claimed
 * scope, expected revision and payload — around the payload above. Both levels are strict, so a `state`,
 * a `subscribed` or `consent` flag, a `confirmed` or `acknowledged` marker, a verification code and any
 * frequency, delivery-schedule or mailing-list field are unrepresentable: an unknown key is refused with
 * that key named and no membership is written.
 */
const signupRequestSchema = mutationInputSchema(signupPayloadSchema);

/** The identity the attempt is reported under: the caller's `operationId` when it states one, and a marker when it does not. */
function attemptIdOf(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return UNIDENTIFIED_ATTEMPT;
  }
  const claimed: unknown = (body as { operationId?: unknown }).operationId;
  return typeof claimed === "string" && claimed.length > 0 ? claimed : UNIDENTIFIED_ATTEMPT;
}

/** Reads the body once; an absent or malformed body becomes the `invalid` answer below rather than a thrown error past this boundary. */
async function jsonBodyOf(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/**
 * Opens one purpose-specific membership for the caller, leaves it `awaiting-proof`, and answers with
 * whichever of the service's eight outcomes the attempt produced. The neutral pending result — the
 * `awaiting-proof` state, `claimsMailSent: false`, and the confirmation deadline resolved from the
 * scenario clock at acceptance — travels in the stored result a replay returns and in the reader's own
 * preference read, so this handler neither builds one nor rewords one. It never confirms: confirmation
 * is the separate, explicit `POST /api/confirm`. It records no preference, reads no release and grants
 * no protected reading.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await jsonBodyOf(request);
  const parsed = signupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return toResponse(outcomeFromError(attemptIdOf(body), parsed.error));
  }
  try {
    return toResponse(await mutations.audience.signupForPurpose(parsed.data));
  } catch (error) {
    // A throw is a defect rather than a presentation: the mutation answers its refusals as outcomes, so a
    // throw means a store or medium fault, or a failure whose fate is not known. The first becomes
    // `unavailable`; the second becomes `unknown` carrying the operation id, so the caller re-queries the
    // same identity instead of sending again.
    return toResponse(outcomeFromError(parsed.data.operationId, error));
  }
}
