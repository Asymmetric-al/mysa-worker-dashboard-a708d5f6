/**
 * The partner mutations: saved views, personal tags and favourites, private preparation, permitted-field
 * contact edits, private notes and recorded interactions.
 *
 * These are the only writes a partner, a private note, a tag, a favourite, a saved view or an
 * interaction ever receives. The eleven names below are the inventory AAP 0.7.1 groups under "Find and
 * open a partner", "Prepare and maintain a contact" and "Record what actually happened"; beside them
 * there is no generic field-level create/update, no second saved-view store and no second tag model.
 *
 * Every export is `(input, source?) => Promise<MutationOutcome>`: it presents the four-field request
 * `../envelope` declares and answers with exactly one outcome from the closed set `../outcome` owns.
 * Each one hands its own payload schema and its own `apply` function to `runMutation`
 * (`../operations`), so the order — validate, resolve the session, assert the claimed scope, ask the
 * mutation's own permission question, decide replay, compare the revision, apply, re-check the scope,
 * record the ledger entry, commit — is written once and nowhere else. Nothing here opens a file, calls
 * `transact`, compares a revision, writes a ledger entry, catches a store fault, mints an operation id,
 * reads a clock other than the scenario clock, or returns a boolean.
 *
 * **Three facts stay three.** A contact method's `permitted` flag is contactability. Communication
 * consent for one publisher and purpose is a membership the audience module owns, and a
 * protected-content reader grant belongs to the content module. Nothing here writes consent: creating a
 * partner, editing a contact method or recording an interaction subscribes nobody, and a tag or a
 * favourite is the worker's own filing rather than a permission.
 *
 * **Private preparation is a different record class.** A `private-preparation` record carries
 * `audience: "private"` and exists beside the shared operational records rather than inside one; it is
 * linked to a shared identity only by a deliberate act this file never infers. Its notes are `private`
 * notes: they appear in the private preparation read and in no shared projection, export or other
 * record's audience.
 *
 * **An interaction records something that happened.** Opening a mail or dialer app, completing a task
 * or scheduling one is not an interaction, and `logInteraction` creates no task: the next task is its
 * own `createTask`, which is why a later task failure can never re-post a saved interaction. An event a
 * source already recorded carries a `{ system, reference }` provenance and is recorded once —
 * `sameSourceReference` is the only permitted comparison, and an equal-looking name, email address or
 * postal address never identifies a record.
 *
 * **Record-level preconditions.** `runMutation` answers `denied` for the authority questions it can ask
 * before a record is touched: the session, the claimed scope and the mutation's own permission
 * question. A condition only the stored record can answer splits two ways. The caller's relationship to
 * the record — this saved view is not the caller's, this record is not in this session's documents, this
 * record is not a private preparation — is answered `denied` from inside the change, through the
 * `{ refused }` arm `../operations` provides for exactly that case: nothing was written, no revision
 * advanced and no history entry appeared, and the answer is identical whether the record is another
 * principal's or not there at all, so the denial discloses nothing a hidden record could be described
 * by. The payload's own effect — this note is already the note being saved, this preparation is already
 * archived, this tag already stands as asked — is answered `unchanged`, because there the payload would
 * change nothing.
 *
 * Layering: a server-side module of the data service. It imports its three sibling contracts, the
 * framework-free time and identity helpers, and `zod`; it imports no component, feature, application
 * route or store, and it writes no diagnostic of its own — `runMutation` logs the outcome, the scope and
 * the elapsed time, and no note body, email address or amount ever reaches that line.
 */
import { z } from "zod";

import { sameSourceReference, type SourceReference } from "@/lib/ids";
import { now } from "@/modules/time/clock";
import { DATE_PRECISIONS, parseCivilDate } from "@/modules/time/civil";

import {
  canEdit,
  canView,
  outcomeOfRefusal,
  resolveSession,
  type AccessDecision,
  type AuthorizationTarget,
  type ResolvedSession,
  type ScopeDecision,
  type SessionSource,
} from "../authorize";
import {
  CONTACT_METHOD_KINDS,
  interactionRecordSchema,
  partnerRecordSchema,
  privateNoteRecordSchema,
  principalIdSchema,
  recordRevisionSchema,
  sourceReferenceSchema,
  type InteractionNote,
  type InteractionParticipant,
  type InteractionRecord,
  type MutationInput,
  type PartnerContactMethod,
  type PartnerNameParts,
  type PartnerRecord,
  type PartnerRestriction,
  type PrivateNoteRecord,
  type Scope,
} from "../envelope";
import {
  runMutation,
  type CurrentTarget,
  type MutationContext,
  type MutationPlan,
} from "../operations";
import { denied, type MutationOutcome, type MutationResult } from "../outcome";

// ---------------------------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------------------------

/**
 * The closed set of things that actually happened with a partner.
 *
 * Each member is a kind of contact that took place, not a channel that was opened: `call` records a
 * conversation that happened, never the act of launching a dialer, and `written-exchange` records that
 * something was written and answered rather than that a message was sent. `other` is the one escape a
 * worker needs for something real the five do not name, and it carries the same `outcome` text as the
 * rest, so no member is a free-form invitation to record a hypothesis.
 */
export const INTERACTION_KINDS = [
  "conversation",
  "visit",
  "call",
  "meeting",
  "written-exchange",
  "other",
] as const;

/** One kind of interaction a worker may record. */
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Bounds
//
// Every bound is stated once and reused by the payload schema and by the code that writes the record,
// so a value that passes validation is a value the stored record's own schema accepts.
// ---------------------------------------------------------------------------------------------

/** The longest identifier a payload may name: opaque, so only its absence is ever refused. */
const OPAQUE_ID_MAX_LENGTH = 160;

/** The longest saved-view name, in Unicode code points as the count a form shows. */
const VIEW_NAME_MAX_LENGTH = 80;

/** The longest search text a saved view stores. */
const SEARCH_TEXT_MAX_LENGTH = 200;

/** The longest facet identifier a saved view stores; a longer one names no facet this build offers. */
const FACET_ID_MAX_LENGTH = 80;

/** The longest facet value a saved view stores; a stored value is never truncated. */
const FACET_VALUE_MAX_LENGTH = 160;

/** How many values one facet may store, matching the bounded facet set's own widest option list. */
const FACET_VALUES_MAX_COUNT = 200;

/** The largest page a list read returns, so a stored page size is never larger than a read can serve. */
const PAGE_SIZE_CAP = 200;

/** The longest display name a partner record carries. */
const DISPLAY_NAME_MAX_LENGTH = 200;

/** The longest additional name part a person record stores. */
const ADDITIONAL_NAME_MAX_LENGTH = 120;

/** How many additional name parts one person may carry. */
const ADDITIONAL_NAMES_MAX_COUNT = 8;

/** The longest value of one contact method: an address or number, kept exactly as entered. */
const CONTACT_VALUE_MAX_LENGTH = 320;

/** How many contact methods one record may carry, matching the three methods and their duplicates. */
const CONTACT_METHODS_MAX_COUNT = 30;

/** The longest source-supplied relationship label (`stage`). */
const STAGE_MAX_LENGTH = 80;

/** The longest restriction label, which is a short source-supplied word rather than a taxonomy. */
const RESTRICTION_KIND_MAX_LENGTH = 80;

/** The longest restriction detail, which states what must not happen. */
const RESTRICTION_DETAIL_MAX_LENGTH = 1_000;

/** How many restrictions one record may carry. */
const RESTRICTIONS_MAX_COUNT = 20;

/** The longest personal tag. */
const TAG_MAX_LENGTH = 40;

/** The longest interaction outcome: a short statement of what came of it. */
const OUTCOME_MAX_LENGTH = 500;

/** The longest participant role label, which is the worker's own word for who took part. */
const PARTICIPANT_ROLE_MAX_LENGTH = 80;

/** How many participants one interaction may record. */
const PARTICIPANTS_MAX_COUNT = 20;

/** The longest private note body, and the longest note attached to an interaction. */
const NOTE_BODY_MAX_LENGTH = 4_000;

// ---------------------------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------------------------

/**
 * An opaque identifier a payload names.
 *
 * It is not trimmed: an identifier is an opaque value this application mints, and silently repairing
 * one would let a request act on a record it did not name.
 */
const opaqueIdSchema = z
  .string()
  .min(1, "Name the record this change applies to: an empty identifier names nothing.")
  .max(
    OPAQUE_ID_MAX_LENGTH,
    `An identifier is at most ${String(OPAQUE_ID_MAX_LENGTH)} characters, and the value supplied is longer.`,
  );

/**
 * A calendar day in the one storage form, read through the domain's own date reader.
 *
 * `parseCivilDate` refuses a date-time string rather than truncating it and refuses a day past the end
 * of its month rather than rolling it forward, so a recorded day is the day supplied and never a
 * fabricated instant.
 */
const civilDateFieldSchema = z
  .string()
  .refine(
    (value) => parseCivilDate(value).status === "parsed",
    "State the day as YYYY-MM-DD. It is read as a calendar day, so a time, a zone or a day that does not exist cannot be understood.",
  );

/** One way of reaching a partner, as a permitted-field edit states it. */
const contactMethodInputSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."),
  value: z
    .string()
    .trim()
    .min(1, "A contact method needs a value.")
    .max(
      CONTACT_VALUE_MAX_LENGTH,
      "This contact method value is longer than a stored record holds.",
    ),
  permitted: z.boolean(),
});

/** The parts a partner's name is recorded in; a part absent from the record is `null`, never empty. */
const namePartsInputSchema = z.strictObject({
  given: z.string().trim().min(1, "A recorded given name cannot be blank.").nullable(),
  family: z.string().trim().min(1, "A recorded family name cannot be blank.").nullable(),
  additional: z
    .array(
      z
        .string()
        .trim()
        .min(1, "A recorded additional name cannot be blank.")
        .max(
          ADDITIONAL_NAME_MAX_LENGTH,
          "This additional name part is longer than a stored record holds.",
        ),
    )
    .max(ADDITIONAL_NAMES_MAX_COUNT, "A name stores at most eight additional parts."),
});

/** A restriction on the relationship, kept with the words the source recorded. */
const restrictionInputSchema = z.strictObject({
  kind: z
    .string()
    .trim()
    .min(1, "A restriction needs a short label.")
    .max(
      RESTRICTION_KIND_MAX_LENGTH,
      "This restriction label is longer than a stored record holds.",
    ),
  detail: z
    .string()
    .trim()
    .min(1, "A restriction states what must not happen.")
    .max(
      RESTRICTION_DETAIL_MAX_LENGTH,
      "This restriction detail is longer than a stored record holds.",
    ),
});

/** A personal tag: the worker's own filing word, trimmed and bounded. */
const tagSchema = z
  .string()
  .trim()
  .min(1, "A tag needs at least one visible character.")
  .max(TAG_MAX_LENGTH, `A tag is at most ${String(TAG_MAX_LENGTH)} characters.`);

/** A private note body: plain text, never empty, never truncated. */
const noteBodySchema = z
  .string()
  .trim()
  .min(1, "A note needs at least one visible character.")
  .max(
    NOTE_BODY_MAX_LENGTH,
    `A note is at most ${String(NOTE_BODY_MAX_LENGTH)} characters; nothing is truncated, so a longer note must be shortened deliberately.`,
  );

/** A saved view's name: the label the worker chose for a set of choices. */
const viewNameSchema = z
  .string()
  .trim()
  .min(1, "A saved view needs a name.")
  .max(
    VIEW_NAME_MAX_LENGTH,
    `A saved view name is at most ${String(VIEW_NAME_MAX_LENGTH)} characters.`,
  );

/**
 * What a saved view stores: the choices, never records.
 *
 * `applied` holds the values selected per facet (AND across facets, OR within one). `columnVisibility`
 * holds the visible column set, `sort` the ordering and `pageSize` the page the worker was reading.
 * The three identifiers inside those members are stored verbatim and judged for drift by the read that
 * offers the facets and columns: a stored view that names a filter this build no longer offers is
 * repaired rather than failed, so nothing here refuses a value for naming a withdrawn choice.
 *
 * The same field declaration serves the payload and the stored record; only their openness differs, and
 * that difference is stated where each is declared.
 */
const savedViewQueryFields = {
  search: z
    .string()
    .max(SEARCH_TEXT_MAX_LENGTH, "The stored search text is longer than a saved view holds."),
  applied: z.record(
    z.string().min(1).max(FACET_ID_MAX_LENGTH),
    z
      .array(z.string().min(1).max(FACET_VALUE_MAX_LENGTH))
      .max(FACET_VALUES_MAX_COUNT, "One facet stores at most two hundred selected values."),
  ),
  columnVisibility: z.record(z.string().min(1).max(FACET_ID_MAX_LENGTH), z.boolean()).optional(),
  sort: z
    .strictObject({
      field: z.string().min(1).max(FACET_ID_MAX_LENGTH),
      direction: z.enum(["asc", "desc"], "A stored sort runs ascending or descending."),
    })
    .optional(),
  pageSize: z.int().min(1).max(PAGE_SIZE_CAP).optional(),
} as const;

/** The query state a payload supplies: a closed shape, never an open field map. */
const savedViewQuerySchema = z.strictObject(savedViewQueryFields);

/** The query state a stored view holds; stored members this build does not read are dropped. */
const storedSavedViewQuerySchema = z.object(savedViewQueryFields);

// ---------------------------------------------------------------------------------------------
// Payload schemas
//
// One schema per mutation, named after it, and each one closed: an unknown member is `invalid` with the
// key named in the message rather than a field quietly dropped. No payload schema accepts a
// server-managed fact — a `revision`, `source`, `kind`, `audience`, `principalId` or `verified` — so an
// attempt to write one is a refusal rather than a silent rewrite.
// ---------------------------------------------------------------------------------------------

/** Save a new saved view, or replace a principal-owned view's stored choices. */
export const saveViewInput = z.strictObject({
  name: viewNameSchema,
  queryState: savedViewQuerySchema,
  viewId: opaqueIdSchema.optional(),
});

/** Rename one saved view the caller owns. */
export const renameViewInput = z.strictObject({
  viewId: opaqueIdSchema,
  name: viewNameSchema,
});

/** Delete one saved view the caller owns. */
export const deleteViewInput = z.strictObject({
  viewId: opaqueIdSchema,
});

/** Apply or remove one personal tag on one partner record. */
export const setTagInput = z.strictObject({
  partnerId: opaqueIdSchema,
  tag: tagSchema,
  present: z.boolean(),
});

/** Mark one partner record as a favourite, or clear it. */
export const setFavouriteInput = z.strictObject({
  partnerId: opaqueIdSchema,
  favourite: z.boolean(),
});

/**
 * Create the worker's own private preparation record for a contact.
 *
 * `displayName` is the only required member: a first session records a private contact from a name
 * alone, which is why contact methods and the opening note are optional.
 */
export const createPrivatePreparationInput = z.strictObject({
  displayName: z
    .string()
    .trim()
    .min(1, "A preparation record needs a name to recognise the contact by.")
    .max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds."),
  contactMethods: z
    .array(contactMethodInputSchema)
    .max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.")
    .optional(),
  note: noteBodySchema.optional(),
});

/**
 * Change the permitted fields of one partner record.
 *
 * The members are the identity display fields, the contact methods with their own `permitted` flag and
 * the relationship and restriction context. Everything else on the record is server-managed and is
 * absent from this schema on purpose: `revision`, `source`, `kind`, `audience`, the giving identity, a
 * communication consent and a method's `verified` flag. A caller that sends one gets `invalid` with
 * that key named, rather than a field that is silently dropped and a caller that believes it wrote it.
 */
export const saveContactEditsInput = z.strictObject({
  partnerId: opaqueIdSchema,
  displayName: z
    .string()
    .trim()
    .min(1, "A display name cannot be blank.")
    .max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds.")
    .optional(),
  nameParts: namePartsInputSchema.optional(),
  contactMethods: z
    .array(contactMethodInputSchema)
    .max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.")
    .optional(),
  restrictions: z
    .array(restrictionInputSchema)
    .max(RESTRICTIONS_MAX_COUNT, "A record stores at most twenty restrictions.")
    .optional(),
  stage: z
    .string()
    .trim()
    .min(1, "A relationship label cannot be blank; send null to clear it.")
    .max(STAGE_MAX_LENGTH, "This relationship label is longer than a stored record holds.")
    .nullable()
    .optional(),
});

/** Archive one private preparation record: hide it from working lists, delete nothing. */
export const archivePreparationInput = z.strictObject({
  partnerId: opaqueIdSchema,
});

/** Restore one archived private preparation record to the working lists. */
export const restorePreparationInput = z.strictObject({
  partnerId: opaqueIdSchema,
});

/** Write one private note about one partner record. */
export const savePrivateNoteInput = z.strictObject({
  partnerId: opaqueIdSchema,
  body: noteBodySchema,
});

/**
 * Record one interaction that actually happened.
 *
 * `occurredOn.precision` is the honesty of the date: `date` and `approximate` state the day the event
 * refers to, and `unknown` states that it is not known, in which case no date is sent at all. The
 * schema refuses a date that disagrees with its precision, because a fabricated midnight is exactly
 * what the precision vocabulary exists to prevent. `provenance` names a source-recorded event so the
 * same event is never logged twice. A participant names a partner record in this context and a role,
 * and no principal: the acting principal is the recorder, so a payload that could name a principal could
 * attribute participation to a colleague who took no part.
 */
export const logInteractionInput = z.strictObject({
  partnerId: opaqueIdSchema,
  type: z.enum(INTERACTION_KINDS, "Choose the kind of contact that took place."),
  occurredOn: z
    .strictObject({
      precision: z.enum(DATE_PRECISIONS, "State how precisely the day is known."),
      date: civilDateFieldSchema.optional(),
    })
    .superRefine((value, context) => {
      if (value.precision === "unknown" && value.date !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["date"],
          message:
            "Unknown precision states that the day is not known, so it carries no date. Nothing is guessed to fill one in.",
        });
      }
      if (value.precision !== "unknown" && value.date === undefined) {
        context.addIssue({
          code: "custom",
          path: ["date"],
          message:
            "State the day this interaction happened on, or record the precision as unknown.",
        });
      }
    }),
  outcome: z
    .string()
    .trim()
    .min(1, "Say what came of the contact.")
    .max(OUTCOME_MAX_LENGTH, "This outcome statement is longer than a stored record holds."),
  participants: z
    .array(
      z.strictObject({
        partnerId: opaqueIdSchema,
        role: z
          .string()
          .trim()
          .min(1, "Say how this person took part.")
          .max(
            PARTICIPANT_ROLE_MAX_LENGTH,
            "This participant role is longer than a stored record holds.",
          ),
      }),
    )
    .min(1, "Name at least one person who took part.")
    .max(PARTICIPANTS_MAX_COUNT, "An interaction records at most twenty participants."),
  note: noteBodySchema.optional(),
  provenance: sourceReferenceSchema.optional(),
});

// ---------------------------------------------------------------------------------------------
// The stored records these mutations read and write
// ---------------------------------------------------------------------------------------------

/**
 * A stored partner record, plus the one archive flag a private preparation may carry.
 *
 * The record itself is validated by the envelope's own schema, which stays the single declaration of
 * its shape; `archived` is added here because archiving hides a preparation from working lists without
 * deleting anything, so the flag describes storage rather than the record's identity. A record that
 * states no flag has not been archived, and a flag can never make a shared record private or a private
 * one shared.
 */
const storedPartnerRecordSchema = partnerRecordSchema.and(
  z.object({ archived: z.boolean().optional() }),
);

/** One stored partner record as this file reads and writes it. */
type StoredPartnerRecord = z.infer<typeof storedPartnerRecordSchema>;

/** One stored saved view: the choices, the principal whose choices they are, and their revision. */
const storedSavedViewSchema = z.object({
  viewId: z.string().min(1),
  name: z.string().min(1),
  query: storedSavedViewQuerySchema,
  ownerPrincipalId: principalIdSchema,
  revision: recordRevisionSchema,
});

/** One stored saved view as this file reads and writes it. */
type StoredSavedView = z.infer<typeof storedSavedViewSchema>;

/** The stored form of a payload's query state. */
type StoredSavedViewQuery = z.infer<typeof storedSavedViewQuerySchema>;

/** The payload form of a query state. */
type SavedViewQueryInput = z.infer<typeof savedViewQuerySchema>;

/** One contact method as a payload states it. */
type ContactMethodInput = z.infer<typeof contactMethodInputSchema>;

/** A name's parts as a payload states them. */
type NamePartsInput = z.infer<typeof namePartsInputSchema>;

/** One restriction as a payload states it. */
type RestrictionInput = z.infer<typeof restrictionInputSchema>;

/**
 * The four record families these mutations own, and every other member of the state document kept
 * exactly as stored.
 *
 * The document is loose rather than strict on purpose: this file writes four families and must write
 * every other family back untouched, so an unrecognised member is preserved instead of dropped. A
 * family absent from the document reads as an empty collection — that is what the seed's own documents
 * state — while a family that is present and unreadable is refused rather than treated as empty, since
 * writing back over a collection that could not be read would lose records.
 */
const stateDocumentSchema = z.looseObject({
  partners: z.array(storedPartnerRecordSchema).default([]),
  privateNotes: z.array(privateNoteRecordSchema).default([]),
  interactions: z.array(interactionRecordSchema).default([]),
  savedViews: z.array(storedSavedViewSchema).default([]),
});

/** A session's state document as these mutations read and write it. */
type StateDocument = z.infer<typeof stateDocumentSchema>;

/** The family a mutation replaces when it commits its change. */
type StateFamily = "partners" | "privateNotes" | "interactions" | "savedViews";

// ---------------------------------------------------------------------------------------------
// What these mutations report
//
// One exact shape per job, so a replayed operation returns the same identifiers it first returned and
// no caller has to interpret an optional member to know what happened.
// ---------------------------------------------------------------------------------------------

/** A change to one partner record: the record, and the revision it now stands at. */
export type PartnerChangeResult = {
  readonly partnerId: string;
  readonly revision: string;
};

/** A change to one partner's tags: the record, the personal tags it now carries, and its revision. */
export type PartnerTagChangeResult = {
  readonly partnerId: string;
  readonly revision: string;
  readonly tags: readonly string[];
};

/** A created private preparation, with the opening note it was created with when one was asked for. */
export type PartnerPreparationResult = {
  readonly partnerId: string;
  readonly revision: string;
  readonly note: { readonly noteId: string; readonly revision: string } | null;
};

/** A written private note: the note, the record it is about, and the note's own revision. */
export type NoteChangeResult = {
  readonly partnerId: string;
  readonly noteId: string;
  readonly revision: string;
};

/** A recorded interaction: the record it is about, the interaction, and the interaction's revision. */
export type InteractionChangeResult = {
  readonly partnerId: string;
  readonly interactionId: string;
  readonly revision: string;
};

/** A saved view this operation created, replaced, renamed or removed. */
export type ViewChangeResult = {
  readonly viewId: string;
  readonly revision: string;
};

// ---------------------------------------------------------------------------------------------
// Running one mutation
// ---------------------------------------------------------------------------------------------

/** The attempt identity a request that states no usable one is answered and refused under. */
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

/**
 * The attempt identity a request carries, read without trusting its type.
 *
 * The same marker `runMutation` uses for an attempt that names none, so a refusal built here is labelled
 * exactly as the runner would label it. A request that reaches this function with no usable identity is
 * refused before any transaction, and its answer still has to name the attempt.
 */
function attemptIdOf(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const candidate: unknown = Reflect.get(input, "operationId");
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return UNIDENTIFIED_ATTEMPT;
}

/**
 * Runs one partner mutation through the single mutation runner.
 *
 * `runMutation` keys its serialised transaction by session, so it needs the session the attempt acts for
 * before it can start one; that identity is resolved here and handed over, and the runner then resolves
 * the session again authoritatively — the request cookie first, the named development path second — and
 * refuses a request that claims a session it did not come from. Nothing else about the order moves:
 * validation, the scope assertion, the mutation's own permission question, replay detection, the
 * revision comparison, the change, the scope re-check and the ledger entry all stay inside
 * `runMutation`, which is the only place in this application that writes them.
 *
 * A session that cannot be established is refused here with the same reason code the runner would give,
 * before any record is looked at, so a request that names no session learns nothing about what it asked
 * about.
 */
async function runPartnerMutation<P, R extends MutationResult>(
  input: MutationInput<P>,
  source: SessionSource | undefined,
  plan: Omit<MutationPlan<P, R>, "sessionId" | "input">,
): Promise<MutationOutcome> {
  let sessionId: string;
  try {
    const resolution = await resolveSession(source);
    if (!resolution.ok) {
      return outcomeOfRefusal(resolution.refusal, attemptIdOf(input));
    }
    sessionId = resolution.session.sessionId;
  } catch {
    // A request scope that cannot yield its cookie leaves no session to establish, which is the one
    // refusal the resolver names for that case.
    return denied({ operationId: attemptIdOf(input), reasonCode: "session-unavailable" });
  }
  return runMutation<P, R>({ ...plan, sessionId, input });
}

/**
 * The payload the runner has already validated, read back through the mutation's own schema.
 *
 * `runMutation` validates the payload before the transaction and never hands the parsed value to
 * `apply`, so a schema that normalises — a trimmed tag, a trimmed display name — would otherwise be
 * applied untrimmed. Reading the payload again through the same schema yields the canonical value, and
 * cannot fail for a request that reached the transaction: a payload that does not parse is answered
 * `invalid` with per-field messages before `apply` runs.
 */
function payloadOf<S extends z.ZodType>(schema: S, input: MutationInput<unknown>): z.output<S> {
  return schema.parse(input.payload);
}

// ---------------------------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------------------------

/**
 * A mutation whose permission question admission itself settles.
 *
 * Two cases reach this answer. A record the caller authors — their saved views, their private
 * preparation, their private notes — adds nothing to admission. A record whose audience only the stored
 * record states — a shared partner, a private preparation that may or may not be the caller's — asks its
 * record-level question inside the change, through `canEdit` against the record that was read; a refusal
 * there answers `denied` with the closed set's own reason code, the same answer whether the record is
 * another principal's or not in this session's documents, so it reports the refusal without becoming an
 * existence oracle.
 *
 * The claimed scope has already been asserted against the session's admitted memberships before this
 * answer is used, so no context question is left open either.
 */
const ADMISSION_ESTABLISHES_AUTHORITY: (session: ResolvedSession) => ScopeDecision = () => ({
  ok: true,
});

/** Re-expresses one record permission answer as the runner's authority decision. */
function authorityOf(decision: AccessDecision): ScopeDecision {
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}

/**
 * The permission question about the caller's own private preparation.
 *
 * A private record belongs to one principal, and a record that states no author is not everyone's: the
 * question states the caller as the author, so a session whose principal differs is refused.
 */
function ownPreparationTarget(scope: Scope, session: ResolvedSession): AuthorizationTarget {
  return { kind: "partner", scope, audience: "private", authorPrincipalId: session.principalId };
}

/**
 * The permission question about one stored partner record.
 *
 * A shared record is the ministry's operational fact and admission permits changing it; a private
 * record belongs to the principal whose preparation it is. The record carries no author field, so a
 * private record is authored by the principal reading this session's own documents — the same evidence
 * the partner read states.
 */
function partnerTarget(
  scope: Scope,
  session: ResolvedSession,
  record: PartnerRecord,
): AuthorizationTarget {
  return {
    kind: "partner",
    scope,
    audience: record.audience,
    authorPrincipalId: record.audience === "private" ? session.principalId : null,
  };
}

/** The permission question about a note the caller wrote for themselves. */
function ownPrivateNoteTarget(scope: Scope, session: ResolvedSession): AuthorizationTarget {
  return { kind: "private-note", scope, authorPrincipalId: session.principalId };
}

/**
 * The permission question about recording something that happened in a context.
 *
 * A logged interaction states the caller as its recorder and no one else, so the question is the
 * context's own admission; it never implies contact permission, a communication consent or a
 * protected-content grant.
 */
function interactionTarget(scope: Scope): AuthorizationTarget {
  return { kind: "interaction", scope };
}

// ---------------------------------------------------------------------------------------------
// Reading and writing the session's records
// ---------------------------------------------------------------------------------------------

/**
 * The store's own name for a document that cannot be decoded.
 *
 * A state document this file cannot read is exactly that condition one layer up, and `outcomeFromError`
 * maps the name to `unavailable` for the local store with the guidance to rebuild the session — the
 * honest answer, because an unreadable document is a source that could not answer and certainly not an
 * empty document a write may build on. Answering `unknown` would claim the effect might have been
 * applied, and answering `unchanged` would hide that the records are unreadable.
 */
const STORE_CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";

/** Builds the fault a state document that cannot be read is answered with. */
function unreadableState(detail: string): Error {
  const error = new Error(
    `This session's records cannot be read: ${detail}. Nothing was written. Reset the development data from Settings to rebuild the session's documents deterministically.`,
  );
  error.name = STORE_CORRUPT_DOCUMENT_FAULT;
  return error;
}

/**
 * Reads the four families these mutations own, keeping every other member of the document as stored.
 *
 * A family the document does not carry reads as empty, which is what a seeded document states; a family
 * that is present and unreadable is refused rather than read as empty.
 */
function stateDocumentOf(docs: MutationContext["docs"]): StateDocument {
  const parsed = stateDocumentSchema.safeParse(docs.state);
  if (!parsed.success) {
    throw unreadableState("a record family in the state document is not readable");
  }
  return parsed.data;
}

/**
 * Writes one family back, leaving every other member of the document exactly as it was read.
 *
 * The draft is a deep copy the transaction owns, so assigning the changed document is the effect; the
 * store writes it only when the transaction commits, and writes nothing when the callback throws.
 */
function writeState(
  docs: MutationContext["docs"],
  state: StateDocument,
  change: Partial<Record<StateFamily, unknown>>,
): void {
  docs.state = { ...state, ...change };
}

/** The stored partner with that identifier, or `undefined` when this context holds no such record. */
function partnerOf(state: StateDocument, partnerId: string): StoredPartnerRecord | undefined {
  return state.partners.find((record) => record.partnerId === partnerId);
}

/** The state with one partner record replaced by its changed form. */
function withPartner(
  state: StateDocument,
  next: StoredPartnerRecord,
): readonly StoredPartnerRecord[] {
  return state.partners.map((record) => (record.partnerId === next.partnerId ? next : record));
}

/** The stored saved view with that identifier, or `undefined` when the document holds none. */
function savedViewOf(state: StateDocument, viewId: string): StoredSavedView | undefined {
  return state.savedViews.find((view) => view.viewId === viewId);
}

// ---------------------------------------------------------------------------------------------
// Comparing what a change would produce with what is stored
// ---------------------------------------------------------------------------------------------

/**
 * Reports whether two name-part records are the same.
 *
 * A part is `null` rather than empty when it is not recorded, so `null` against an empty string is a
 * difference: one states that nothing is known and the other is not a value at all.
 */
function sameNameParts(left: PartnerNameParts | null, right: PartnerNameParts | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.given === right.given &&
    left.family === right.family &&
    left.additional.length === right.additional.length &&
    left.additional.every((part, index) => part === right.additional[index])
  );
}

/** Reports whether two contact method lists state the same methods, in the same order. */
function sameContactMethods(
  left: readonly PartnerContactMethod[],
  right: readonly PartnerContactMethod[],
): boolean {
  return (
    left.length === right.length &&
    left.every((method, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.kind === method.kind &&
        other.value === method.value &&
        other.permitted === method.permitted
      );
    })
  );
}

/** Reports whether two restriction lists state the same restrictions, in the same order. */
function sameRestrictions(
  left: readonly PartnerRestriction[],
  right: readonly PartnerRestriction[],
): boolean {
  return (
    left.length === right.length &&
    left.every((restriction, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.kind === restriction.kind &&
        other.detail === restriction.detail
      );
    })
  );
}

/**
 * The stored form of a payload's query state, with every member in the schema's own field order and each
 * identifier map sorted.
 *
 * Sorting makes the stored document deterministic and makes two identical selections one selection: the
 * values chosen for a facet are a set, so the order a worker happened to click them in is not part of
 * what the view means. It also lets an Update recognise that it would store what is already stored,
 * which is what keeps a repeated save from advancing a revision for nothing.
 */
function storedQueryOf(query: SavedViewQueryInput): StoredSavedViewQuery {
  const applied: Record<string, string[]> = {};
  for (const facetId of Object.keys(query.applied).sort()) {
    const values = query.applied[facetId];
    if (values === undefined || values.length === 0) {
      continue;
    }
    applied[facetId] = [...values].sort();
  }

  const visibility = query.columnVisibility ?? {};
  const columnVisibility: Record<string, boolean> = {};
  for (const columnId of Object.keys(visibility).sort()) {
    const visible = visibility[columnId];
    if (visible !== undefined) {
      columnVisibility[columnId] = visible;
    }
  }

  return {
    search: query.search,
    applied,
    ...(Object.keys(columnVisibility).length === 0 ? {} : { columnVisibility }),
    ...(query.sort === undefined
      ? {}
      : { sort: { field: query.sort.field, direction: query.sort.direction } }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
  };
}

/**
 * Reports whether two stored query states hold the same choices.
 *
 * Both sides are built in the schema's field order — one by {@link storedQueryOf}, the other by the
 * stored query's own parse — so the canonical serialisation compares the choices and nothing else.
 */
function sameQuery(left: StoredSavedViewQuery, right: StoredSavedViewQuery): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// ---------------------------------------------------------------------------------------------
// Building the stored values a payload describes
// ---------------------------------------------------------------------------------------------

/**
 * Mints the opaque identity of a record this application owns.
 *
 * A record identifier names a record, not an attempt, so it is minted here rather than through
 * `newOperationId`: conflating the two would let an attempt identity travel as a record's identity.
 */
function newRecordId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Mints the revision a changed record now stands at.
 *
 * A revision is an opaque optimistic-concurrency token: the change that comes next presents this value
 * as its `expectedRevision`, and a value another change has replaced is a `conflict` that preserves the
 * caller's input. Seeded records start at the seed's own token; every accepted change advances to a
 * freshly minted one.
 */
function nextRevision(): string {
  return globalThis.crypto.randomUUID();
}

/** The stored contact methods a payload's list describes: never verified, always with their permission. */
function contactMethodsOf(methods: readonly ContactMethodInput[]): readonly PartnerContactMethod[] {
  return methods.map((method) => ({
    kind: method.kind,
    value: method.value,
    permitted: method.permitted,
    verified: false,
  }));
}

/** The stored name parts a payload's name describes. */
function namePartsOf(parts: NamePartsInput): PartnerNameParts {
  return { given: parts.given, family: parts.family, additional: [...parts.additional] };
}

/** The stored restrictions a payload's list describes, kept with the words supplied. */
function restrictionsOf(restrictions: readonly RestrictionInput[]): readonly PartnerRestriction[] {
  return restrictions.map((restriction) => ({
    kind: restriction.kind,
    detail: restriction.detail,
  }));
}

/** The instant a record written now is stamped with, from the scenario clock and no other. */
function recordedAt(): string {
  return now().toString();
}

// ---------------------------------------------------------------------------------------------
// The payload types these mutations accept
// ---------------------------------------------------------------------------------------------

/** The payload `saveView` accepts: a name, the closed query state, and an existing view to replace. */
export type SaveViewInput = z.output<typeof saveViewInput>;
/** The payload `renameView` accepts. */
export type RenameViewInput = z.output<typeof renameViewInput>;
/** The payload `deleteView` accepts. */
export type DeleteViewInput = z.output<typeof deleteViewInput>;
/** The payload `setTag` accepts. */
export type SetTagInput = z.output<typeof setTagInput>;
/** The payload `setFavourite` accepts. */
export type SetFavouriteInput = z.output<typeof setFavouriteInput>;
/** The payload `createPrivatePreparation` accepts. */
export type CreatePrivatePreparationInput = z.output<typeof createPrivatePreparationInput>;
/** The payload `saveContactEdits` accepts. */
export type SaveContactEditsInput = z.output<typeof saveContactEditsInput>;
/** The payload `archivePreparation` accepts. */
export type ArchivePreparationInput = z.output<typeof archivePreparationInput>;
/** The payload `restorePreparation` accepts. */
export type RestorePreparationInput = z.output<typeof restorePreparationInput>;
/** The payload `savePrivateNote` accepts. */
export type SavePrivateNoteInput = z.output<typeof savePrivateNoteInput>;
/** The payload `logInteraction` accepts. */
export type LogInteractionInput = z.output<typeof logInteractionInput>;

// ---------------------------------------------------------------------------------------------
// Locating the record an attempt names
// ---------------------------------------------------------------------------------------------

/** The target of a change that creates a record: there is no stored value a revision could compare. */
const ABSENT_TARGET: CurrentTarget = { kind: "absent" };

/** Reporting that a request would change nothing: no revision advance and no history entry. */
const NOTHING_TO_CHANGE = { changed: false } as const;

/**
 * The refusal for a caller this record does not admit, reached only by reading the record itself.
 *
 * Whether the named view, note, preparation or partner is another principal's, is outside this
 * session's documents, or is not the record class the command acts on cannot be known before the
 * transaction, so the answer is built here instead of by the runner. It is `denied` and not
 * `unchanged` because the caller was refused an action rather than shown that nothing needed doing, and
 * the reason code is the closed set's own: the answer is identical whether the record exists elsewhere
 * or does not exist at all, so it describes no hidden record while reporting the refusal honestly.
 */
function refuseDenied(operationId: string): { readonly refused: MutationOutcome } {
  return { refused: denied({ operationId, reasonCode: "no-permission" }) };
}

/**
 * A member of an untrusted payload, read structurally.
 *
 * `readCurrent` and the payload accessors below run against the object that arrived, so a value the
 * schema has already validated is still read as `unknown` here rather than assumed: nothing in this file
 * trusts a type it did not check, and a malformed member is answered as "no such record" instead of
 * throwing out of a record lookup.
 */
function memberOf(payload: unknown, member: string): unknown {
  return typeof payload === "object" && payload !== null ? Reflect.get(payload, member) : undefined;
}

/** The partner identifier a request names, or the empty string when it names none. */
function partnerIdOf(input: MutationInput<unknown>): string {
  const candidate = memberOf(input.payload, "partnerId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "";
}

/** The saved-view identifier a request names, or `undefined` when it creates a view instead. */
function savedViewIdOf(input: MutationInput<unknown>): string | undefined {
  const candidate = memberOf(input.payload, "viewId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/**
 * Where one partner record now stands, for the runner's revision comparison.
 *
 * A record this context does not hold is `absent`: a creation compares no revision, and a change whose
 * target is not here has nothing to overwrite. An absent record and a record the caller may not see are
 * answered alike, which is why no permission question is asked at this point.
 */
function partnerCurrentTarget(docs: MutationContext["docs"], partnerId: string): CurrentTarget {
  const record = partnerOf(stateDocumentOf(docs), partnerId);
  return record === undefined
    ? ABSENT_TARGET
    : { kind: "record", revision: record.revision, value: record };
}

/**
 * Where one saved view now stands, for the runner's revision comparison.
 *
 * Only the caller's own view is a target: a view another principal stored is `absent` here, so a stale
 * toolbar can never address it and learns nothing about whether it exists. A creation presents no view
 * at all, which is why the revision of the collection is never what an update compares.
 */
function savedViewCurrentTarget(
  docs: MutationContext["docs"],
  viewId: string | undefined,
  principalId: string,
): CurrentTarget {
  if (viewId === undefined) {
    return ABSENT_TARGET;
  }
  const view = savedViewOf(stateDocumentOf(docs), viewId);
  if (view === undefined || view.ownerPrincipalId !== principalId) {
    return ABSENT_TARGET;
  }
  return { kind: "record", revision: view.revision, value: view };
}

/**
 * Reports whether two partner records state the same permitted fields.
 *
 * The comparison is over exactly the fields a contact edit may change, so an edit that changes nothing
 * answers `unchanged` and leaves no history entry behind — a form resubmitted untouched is not work
 * somebody did. Tags, favourites, the audience and the archive flag are not part of it: no contact edit
 * may state them.
 */
function samePermittedFields(current: PartnerRecord, next: PartnerRecord): boolean {
  return (
    current.displayName === next.displayName &&
    sameNameParts(current.nameParts, next.nameParts) &&
    sameContactMethods(current.contactMethods, next.contactMethods) &&
    sameRestrictions(current.restrictions, next.restrictions) &&
    current.stage === next.stage
  );
}

// ---------------------------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------------------------

/**
 * Saves a new saved view for the caller, or replaces a view the caller already owns.
 *
 * Outcome set: `accepted` (created or replaced), `alreadyAccepted` (the same attempt replayed),
 * `unchanged` (the same choices are already stored), `conflict` (the view moved since it was read),
 * `denied` (no admitted context, or the named view is not the caller's), `invalid` (a malformed payload
 * or an unknown member), `unavailable` (the records cannot be read) and `unknown` (the effect may have
 * happened and the acknowledgement was lost).
 */
export async function saveView(
  input: MutationInput<SaveViewInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<SaveViewInput, ViewChangeResult>(input, source, {
    name: "saveView",
    schema: saveViewInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) =>
      savedViewCurrentTarget(docs, savedViewIdOf(input), input.scope.principalId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(saveViewInput, input);
      const state = stateDocumentOf(docs);
      const query = storedQueryOf(payload.queryState);

      if (payload.viewId === undefined) {
        const viewId = newRecordId();
        const revision = nextRevision();
        const view: StoredSavedView = {
          viewId,
          name: payload.name,
          query,
          ownerPrincipalId: session.principalId,
          revision,
        };
        writeState(docs, state, { savedViews: [...state.savedViews, view] });
        return {
          changed: true,
          revision,
          result: { viewId, revision },
          created: [viewId],
        };
      }

      const view = savedViewOf(state, payload.viewId);
      if (view === undefined || view.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (view.name === payload.name && sameQuery(view.query, query)) {
        return NOTHING_TO_CHANGE;
      }

      const revision = nextRevision();
      const replaced: StoredSavedView = { ...view, name: payload.name, query, revision };
      writeState(docs, state, {
        savedViews: state.savedViews.map((candidate) =>
          candidate.viewId === replaced.viewId ? replaced : candidate,
        ),
      });
      return {
        changed: true,
        revision,
        result: { viewId: replaced.viewId, revision },
        changedIds: [replaced.viewId],
      };
    },
  });
}

/**
 * Renames one saved view the caller owns.
 *
 * Outcome set: `accepted` (renamed), `alreadyAccepted` (the same attempt replayed), `unchanged` (the
 * name is already that name), `conflict` (the view moved since it was read), `denied` (no admitted
 * context, or the named view is not the caller's), `invalid`, `unavailable` and `unknown`, as every
 * mutation here answers them.
 */
export async function renameView(
  input: MutationInput<RenameViewInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<RenameViewInput, ViewChangeResult>(input, source, {
    name: "renameView",
    schema: renameViewInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) =>
      savedViewCurrentTarget(docs, savedViewIdOf(input), input.scope.principalId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(renameViewInput, input);
      const state = stateDocumentOf(docs);
      const view = savedViewOf(state, payload.viewId);
      if (view === undefined || view.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }
      if (view.name === payload.name) {
        return NOTHING_TO_CHANGE;
      }

      const revision = nextRevision();
      const renamed: StoredSavedView = { ...view, name: payload.name, revision };
      writeState(docs, state, {
        savedViews: state.savedViews.map((candidate) =>
          candidate.viewId === renamed.viewId ? renamed : candidate,
        ),
      });
      return {
        changed: true,
        revision,
        result: { viewId: renamed.viewId, revision },
        changedIds: [renamed.viewId],
      };
    },
  });
}

/**
 * Deletes one saved view the caller owns; no record is touched by deleting a view.
 *
 * Outcome set: `accepted` (removed), `alreadyAccepted` (the same attempt replayed), `conflict` (the view
 * moved since it was read), `denied` (no admitted context, or the named view is not the caller's — a
 * stale toolbar is refused with the same answer a view that is not there receives), `invalid`,
 * `unavailable` and `unknown`.
 */
export async function deleteView(
  input: MutationInput<DeleteViewInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<DeleteViewInput, ViewChangeResult>(input, source, {
    name: "deleteView",
    schema: deleteViewInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) =>
      savedViewCurrentTarget(docs, savedViewIdOf(input), input.scope.principalId),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(deleteViewInput, input);
      const state = stateDocumentOf(docs);
      const view = savedViewOf(state, payload.viewId);
      if (view === undefined || view.ownerPrincipalId !== session.principalId) {
        return refuseDenied(operationId);
      }

      writeState(docs, state, {
        savedViews: state.savedViews.filter((candidate) => candidate.viewId !== view.viewId),
      });
      // A removed view no longer stands at a revision of its own, so the answer reports the revision it
      // stood at when the removal was made: nothing else can be presented for a record that is gone, and
      // the view list is read again with its own revisions.
      return {
        changed: true,
        revision: view.revision,
        result: { viewId: view.viewId, revision: view.revision },
        changedIds: [view.viewId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Personal filing: tags and favourites
// ---------------------------------------------------------------------------------------------

/**
 * Applies or removes one personal tag on one partner record.
 *
 * A tag is the worker's own filing word. It is not a segment, an audience, a consent or a permission: no
 * membership, no contactability flag and no protected-content grant follows from it.
 *
 * Outcome set: `accepted` (the tag list changed), `alreadyAccepted`, `unchanged` (the tag is already
 * absent or already present), `conflict` (the record moved since it was read), `denied` (no admitted
 * context, or the record is not one the caller may change), `invalid`, `unavailable` and `unknown`.
 */
export async function setTag(
  input: MutationInput<SetTagInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<SetTagInput, PartnerTagChangeResult>(input, source, {
    name: "setTag",
    schema: setTagInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(setTagInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        !canEdit(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }

      const held = record.tags.includes(payload.tag);
      if (held === payload.present) {
        return NOTHING_TO_CHANGE;
      }

      const tags = payload.present
        ? [...record.tags, payload.tag]
        : record.tags.filter((tag) => tag !== payload.tag);
      const revision = nextRevision();
      const tagged: StoredPartnerRecord = { ...record, tags, revision };
      writeState(docs, state, { partners: withPartner(state, tagged) });
      return {
        changed: true,
        revision,
        result: { partnerId: tagged.partnerId, revision, tags },
        changedIds: [tagged.partnerId],
      };
    },
  });
}

/**
 * Marks one partner record as a favourite, or clears the mark.
 *
 * A favourite is the worker's own shortlist. It changes no record's activity, gives nothing and proves
 * nothing about the relationship.
 *
 * Outcome set: `accepted`, `alreadyAccepted`, `unchanged` (the record already stands as asked),
 * `conflict`, `denied` (no admitted context, or the record is not one the caller may change), `invalid`,
 * `unavailable` and `unknown`.
 */
export async function setFavourite(
  input: MutationInput<SetFavouriteInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<SetFavouriteInput, PartnerChangeResult>(input, source, {
    name: "setFavourite",
    schema: setFavouriteInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(setFavouriteInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        !canEdit(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }
      if (record.favourite === payload.favourite) {
        return NOTHING_TO_CHANGE;
      }

      const revision = nextRevision();
      const marked: StoredPartnerRecord = { ...record, favourite: payload.favourite, revision };
      writeState(docs, state, { partners: withPartner(state, marked) });
      return {
        changed: true,
        revision,
        result: { partnerId: marked.partnerId, revision },
        changedIds: [marked.partnerId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Private preparation: creation, contact edits, archive and restore
// ---------------------------------------------------------------------------------------------

/**
 * Creates the worker's own private preparation record for a contact, with its opening note if one is
 * given.
 *
 * The record is created with `kind: "private-preparation"` and `audience: "private"`, authored by the
 * acting principal, and it creates no shared identity: linking a preparation to a shared record is a
 * deliberate act, so nothing here is inferred from a matching name, email address or postal address. The
 * opening note is a private note with its own revision, and neither records nor implies consent to
 * receive anything.
 *
 * Outcome set: `accepted` (created, with the opening note when one was asked for), `alreadyAccepted` (the
 * same attempt replayed, returning the identifiers it first returned), `denied` (no admitted context, or
 * the caller may not keep a preparation), `invalid`, `unavailable` and `unknown`.
 */
export async function createPrivatePreparation(
  input: MutationInput<CreatePrivatePreparationInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<CreatePrivatePreparationInput, PartnerPreparationResult>(
    input,
    source,
    {
      name: "createPrivatePreparation",
      schema: createPrivatePreparationInput,
      authorize: (session) =>
        authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
      apply: ({ docs, session }) => {
        const payload = payloadOf(createPrivatePreparationInput, input);
        const state = stateDocumentOf(docs);

        const partnerId = newRecordId();
        const revision = nextRevision();
        const record: StoredPartnerRecord = {
          partnerId,
          kind: "private-preparation",
          displayName: payload.displayName,
          nameParts: null,
          contactMethods: contactMethodsOf(payload.contactMethods ?? []),
          restrictions: [],
          tags: [],
          favourite: false,
          stage: null,
          audience: "private",
          revision,
          source: null,
        };

        if (payload.note === undefined) {
          writeState(docs, state, { partners: [...state.partners, record] });
          return {
            changed: true,
            revision,
            result: { partnerId, revision, note: null },
            created: [partnerId],
          };
        }

        const note: PrivateNoteRecord = {
          noteId: newRecordId(),
          partnerId,
          authorPrincipalId: session.principalId,
          body: payload.note,
          audience: "private",
          createdAt: recordedAt(),
          revision: nextRevision(),
        };
        writeState(docs, state, {
          partners: [...state.partners, record],
          privateNotes: [...state.privateNotes, note],
        });
        return {
          changed: true,
          revision,
          result: { partnerId, revision, note: { noteId: note.noteId, revision: note.revision } },
          created: [partnerId, note.noteId],
        };
      },
    },
  );
}

/**
 * Changes the permitted fields of one partner record: its display name and name parts, its contact
 * methods with their own `permitted` flag, its restrictions and its relationship label.
 *
 * Every other fact on the record is server-managed and cannot be stated by this payload: the revision,
 * the source reference, the record kind, the audience, the giving identity, a communication consent and
 * a contact method's `verified` flag. A contact method is never consent and never contactability of
 * another kind: `permitted` says only whether the worker may use that method to reach this person.
 *
 * Outcome set: `accepted` (a permitted field changed), `alreadyAccepted`, `unchanged` (nothing differs),
 * `conflict` (the record moved since it was read, and the caller's input travels back beside the stored
 * value), `denied` (no admitted context, or the record is not one the caller may change), `invalid`,
 * `unavailable` and `unknown`.
 */
export async function saveContactEdits(
  input: MutationInput<SaveContactEditsInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<SaveContactEditsInput, PartnerChangeResult>(input, source, {
    name: "saveContactEdits",
    schema: saveContactEditsInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(saveContactEditsInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        !canEdit(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }

      const next: StoredPartnerRecord = {
        ...record,
        displayName: payload.displayName ?? record.displayName,
        nameParts:
          payload.nameParts === undefined ? record.nameParts : namePartsOf(payload.nameParts),
        contactMethods:
          payload.contactMethods === undefined
            ? record.contactMethods
            : contactMethodsOf(payload.contactMethods),
        restrictions:
          payload.restrictions === undefined
            ? record.restrictions
            : restrictionsOf(payload.restrictions),
        stage: payload.stage === undefined ? record.stage : payload.stage,
      };
      if (samePermittedFields(record, next)) {
        return NOTHING_TO_CHANGE;
      }

      const revision = nextRevision();
      const edited: StoredPartnerRecord = { ...next, revision };
      writeState(docs, state, { partners: withPartner(state, edited) });
      return {
        changed: true,
        revision,
        result: { partnerId: edited.partnerId, revision },
        changedIds: [edited.partnerId],
      };
    },
  });
}

/**
 * Archives one private preparation record: it leaves the working lists and nothing is deleted.
 *
 * Only the worker's own preparation can be archived. A shared operational record, a record another
 * principal keeps and a record this context does not hold are refused `denied` with the closed set's own
 * reason code — the same answer in each case, so nothing about a record the caller may not archive is
 * disclosed; the read that offers the action already reports it as unavailable with its reason, so a
 * surface never presents it as offered. Archiving preserves the record, its notes and its history, and
 * touches no other record, task, interaction or obligation.
 *
 * Outcome set: `accepted` (archived), `alreadyAccepted`, `unchanged` (already archived), `conflict`,
 * `denied` (no admitted context, or the record is not a private preparation the caller may archive in
 * this context), `invalid`, `unavailable` and `unknown`.
 */
export async function archivePreparation(
  input: MutationInput<ArchivePreparationInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<ArchivePreparationInput, PartnerChangeResult>(input, source, {
    name: "archivePreparation",
    schema: archivePreparationInput,
    authorize: (session) =>
      authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(archivePreparationInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        record.kind !== "private-preparation" ||
        record.audience !== "private" ||
        !canEdit(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }
      if (record.archived === true) {
        return NOTHING_TO_CHANGE;
      }

      const revision = nextRevision();
      const archived: StoredPartnerRecord = { ...record, archived: true, revision };
      writeState(docs, state, { partners: withPartner(state, archived) });
      return {
        changed: true,
        revision,
        result: { partnerId: archived.partnerId, revision },
        changedIds: [archived.partnerId],
      };
    },
  });
}

/**
 * Restores one archived private preparation record to the working lists.
 *
 * The record returns with its content as it was left: restoring writes the archive flag and a revision,
 * nothing else. A record that is already present — a stale restore, or a repeat after a lost
 * acknowledgement — answers `unchanged`.
 *
 * Outcome set: `accepted` (restored), `alreadyAccepted`, `unchanged` (already present, so not archived),
 * `conflict`, `denied` (no admitted context, or the record is not a private preparation the caller may
 * restore in this context), `invalid`, `unavailable` and `unknown`.
 */
export async function restorePreparation(
  input: MutationInput<RestorePreparationInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<RestorePreparationInput, PartnerChangeResult>(input, source, {
    name: "restorePreparation",
    schema: restorePreparationInput,
    authorize: (session) =>
      authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(restorePreparationInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        record.kind !== "private-preparation" ||
        record.audience !== "private" ||
        !canEdit(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }
      if (record.archived !== true) {
        return NOTHING_TO_CHANGE;
      }

      const revision = nextRevision();
      const restored: StoredPartnerRecord = { ...record, archived: false, revision };
      writeState(docs, state, { partners: withPartner(state, restored) });
      return {
        changed: true,
        revision,
        result: { partnerId: restored.partnerId, revision },
        changedIds: [restored.partnerId],
      };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Recorded activity
// ---------------------------------------------------------------------------------------------

/**
 * Writes one private note about one partner record.
 *
 * The note is audience-labelled `private` and carries its author, which is the only record of who wrote
 * it: it appears in the private preparation read and in no shared projection, export or other record's
 * audience. Writing a note records nothing that happened and creates no interaction, so a note is never
 * read as activity.
 *
 * Outcome set: `accepted` (written), `alreadyAccepted`, `unchanged` (the same author already wrote this
 * exact note about this record), `denied` (no admitted context, the caller may not keep a private note
 * here, or the record is not one the caller may read), `invalid`, `unavailable` and `unknown`.
 */
export async function savePrivateNote(
  input: MutationInput<SavePrivateNoteInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<SavePrivateNoteInput, NoteChangeResult>(input, source, {
    name: "savePrivateNote",
    schema: savePrivateNoteInput,
    authorize: (session) =>
      authorityOf(canEdit(session, ownPrivateNoteTarget(input.scope, session))),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(savePrivateNoteInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        !canView(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }

      const alreadyWritten = state.privateNotes.some(
        (note) =>
          note.partnerId === record.partnerId &&
          note.authorPrincipalId === session.principalId &&
          note.body === payload.body,
      );
      if (alreadyWritten) {
        return NOTHING_TO_CHANGE;
      }

      const note: PrivateNoteRecord = {
        noteId: newRecordId(),
        partnerId: record.partnerId,
        authorPrincipalId: session.principalId,
        body: payload.body,
        audience: "private",
        createdAt: recordedAt(),
        revision: nextRevision(),
      };
      writeState(docs, state, { privateNotes: [...state.privateNotes, note] });
      return {
        changed: true,
        revision: note.revision,
        result: { partnerId: note.partnerId, noteId: note.noteId, revision: note.revision },
        created: [note.noteId],
      };
    },
  });
}

/**
 * Records one interaction that actually happened with a partner.
 *
 * The record states what took place, the precision its date is known to, what came of it and who took
 * part. It creates no task and no gift: the next task is a separate `createTask`, which is why a later
 * task-creation failure can never re-post the saved interaction, and completing a task or opening a
 * mail or dialer app is never an interaction. An event a source already recorded carries a source
 * reference and is recorded once; re-recording that same reference answers `unchanged`, and
 * `sameSourceReference` is the only comparison made about it.
 *
 * Outcome set: `accepted` (recorded), `alreadyAccepted`, `unchanged` (this source reference is already
 * recorded, or a participant names no record in this context), `denied` (no admitted context, the caller
 * may not record an interaction here, or the partner is not one the caller may read), `invalid`,
 * `unavailable` and `unknown`.
 */
export async function logInteraction(
  input: MutationInput<LogInteractionInput>,
  source?: SessionSource,
): Promise<MutationOutcome> {
  return runPartnerMutation<LogInteractionInput, InteractionChangeResult>(input, source, {
    name: "logInteraction",
    schema: logInteractionInput,
    authorize: (session) => authorityOf(canEdit(session, interactionTarget(input.scope))),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(logInteractionInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (
        record === undefined ||
        !canView(session, partnerTarget(input.scope, session, record)).allowed
      ) {
        return refuseDenied(operationId);
      }

      const provenance: SourceReference | null = payload.provenance ?? null;
      if (
        provenance !== null &&
        state.interactions.some(
          (interaction) =>
            interaction.provenance !== null &&
            sameSourceReference(interaction.provenance, provenance),
        )
      ) {
        // The source recorded this event once already, so a second record of it would state that it
        // happened twice. The stored record is what the source stands behind, and it is left as it is.
        return NOTHING_TO_CHANGE;
      }

      const participants: readonly InteractionParticipant[] = payload.participants.map(
        (participant) => ({
          role: participant.role,
          partnerId: partnerOf(state, participant.partnerId)?.partnerId ?? null,
          principalId: null,
        }),
      );
      if (participants.some((participant) => participant.partnerId === null)) {
        // A participant this context holds no record of would point at nothing. Guessing a person from
        // a name is exactly the identity inference this application refuses, so nothing is recorded.
        return NOTHING_TO_CHANGE;
      }

      const note: InteractionNote | null =
        payload.note === undefined ? null : { body: payload.note, audience: "private" };
      const interaction: InteractionRecord = {
        interactionId: newRecordId(),
        partnerId: record.partnerId,
        type: payload.type,
        occurredOn:
          payload.occurredOn.precision === "unknown" ? null : (payload.occurredOn.date ?? null),
        precision: payload.occurredOn.precision,
        outcome: payload.outcome,
        participants,
        note,
        provenance,
        revision: nextRevision(),
      };
      writeState(docs, state, { interactions: [...state.interactions, interaction] });
      return {
        changed: true,
        revision: interaction.revision,
        result: {
          partnerId: interaction.partnerId,
          interactionId: interaction.interactionId,
          revision: interaction.revision,
        },
        created: [interaction.interactionId],
      };
    },
  });
}
