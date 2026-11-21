/**
 * The partner mutations: saved views, personal tags and favourites, private preparation,
 * permitted-field contact edits, private notes and recorded interactions.
 */
import { z } from "zod";
import { sameSourceReference, type SourceReference } from "@/lib/ids";
import { now } from "@/modules/time/clock";
import { DATE_PRECISIONS, parseCivilDate } from "@/modules/time/civil";
import { canEdit, canView, outcomeOfRefusal, resolveSession, type AccessDecision, type AuthorizationTarget, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
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
import { runMutation, type CurrentTarget, type MutationContext, type MutationPlan } from "../operations";
import { denied, type MutationOutcome, type MutationResult } from "../outcome";
// Closed vocabularies
/** The closed set of things that actually happened with a partner. */
export const INTERACTION_KINDS = ["conversation", "visit", "call", "meeting", "written-exchange", "other"] as const;
/** One kind of interaction a worker may record. */
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
// Bounds
//
// Every bound is stated once and reused by the payload schema and by the code that writes the record,
// so a value that passes validation is a value the stored record's own schema accepts.
const OPAQUE_ID_MAX_LENGTH = 160;

const VIEW_NAME_MAX_LENGTH = 80;

const SEARCH_TEXT_MAX_LENGTH = 200;

const FACET_ID_MAX_LENGTH = 80;

const FACET_VALUE_MAX_LENGTH = 160;

const FACET_VALUES_MAX_COUNT = 200;

const PAGE_SIZE_CAP = 200;

const DISPLAY_NAME_MAX_LENGTH = 200;

const ADDITIONAL_NAME_MAX_LENGTH = 120;

const ADDITIONAL_NAMES_MAX_COUNT = 8;

const CONTACT_VALUE_MAX_LENGTH = 320;

const CONTACT_METHODS_MAX_COUNT = 30;

const STAGE_MAX_LENGTH = 80;

const RESTRICTION_KIND_MAX_LENGTH = 80;

const RESTRICTION_DETAIL_MAX_LENGTH = 1_000;

const RESTRICTIONS_MAX_COUNT = 20;

const TAG_MAX_LENGTH = 40;

const OUTCOME_MAX_LENGTH = 500;

const PARTICIPANT_ROLE_MAX_LENGTH = 80;

const PARTICIPANTS_MAX_COUNT = 20;

const NOTE_BODY_MAX_LENGTH = 4_000;
// Shared field schemas
const opaqueIdSchema = z
  .string()
  .min(1, "Name the record this change applies to: an empty identifier names nothing.")
  .max(OPAQUE_ID_MAX_LENGTH, `An identifier is at most ${String(OPAQUE_ID_MAX_LENGTH)} characters, and the value supplied is longer.`);
const civilDateFieldSchema = z
  .string()
  .refine((value) => parseCivilDate(value).status === "parsed", "State the day as YYYY-MM-DD. It is read as a calendar day, so a time, a zone or a day that does not exist cannot be understood.");
const contactMethodInputSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."),
  value: z.string().trim().min(1, "A contact method needs a value.").max(CONTACT_VALUE_MAX_LENGTH, "This contact method value is longer than a stored record holds."),
  permitted: z.boolean(),
});
const namePartsInputSchema = z.strictObject({
  given: z.string().trim().min(1, "A recorded given name cannot be blank.").nullable(),
  family: z.string().trim().min(1, "A recorded family name cannot be blank.").nullable(),
  additional: z
    .array(z.string().trim().min(1, "A recorded additional name cannot be blank.").max(ADDITIONAL_NAME_MAX_LENGTH, "This additional name part is longer than a stored record holds."))
    .max(ADDITIONAL_NAMES_MAX_COUNT, "A name stores at most eight additional parts."),
});
const restrictionInputSchema = z.strictObject({
  kind: z.string().trim().min(1, "A restriction needs a short label.").max(RESTRICTION_KIND_MAX_LENGTH, "This restriction label is longer than a stored record holds."),
  detail: z.string().trim().min(1, "A restriction states what must not happen.").max(RESTRICTION_DETAIL_MAX_LENGTH, "This restriction detail is longer than a stored record holds."),
});
const tagSchema = z
  .string()
  .trim()
  .min(1, "A tag needs at least one visible character.")
  .max(TAG_MAX_LENGTH, `A tag is at most ${String(TAG_MAX_LENGTH)} characters.`);
const noteBodySchema = z
  .string()
  .trim()
  .min(1, "A note needs at least one visible character.")
  .max(NOTE_BODY_MAX_LENGTH, `A note is at most ${String(NOTE_BODY_MAX_LENGTH)} characters; nothing is truncated, so a longer note must be shortened deliberately.`);
const viewNameSchema = z
  .string()
  .trim()
  .min(1, "A saved view needs a name.")
  .max(VIEW_NAME_MAX_LENGTH, `A saved view name is at most ${String(VIEW_NAME_MAX_LENGTH)} characters.`);
const savedViewQueryFields = {
  search: z.string().max(SEARCH_TEXT_MAX_LENGTH, "The stored search text is longer than a saved view holds."),
  applied: z.record(
    z.string().min(1).max(FACET_ID_MAX_LENGTH),
    z.array(z.string().min(1).max(FACET_VALUE_MAX_LENGTH)).max(FACET_VALUES_MAX_COUNT, "One facet stores at most two hundred selected values."),
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
const savedViewQuerySchema = z.strictObject(savedViewQueryFields);

const storedSavedViewQuerySchema = z.object(savedViewQueryFields);
// Payload schemas
//
// One schema per mutation, named after it, and each one closed: an unknown member is `invalid` with the
// key named in the message rather than a field quietly dropped. No payload schema accepts a
// server-managed fact — a `revision`, `source`, `kind`, `audience`, `principalId` or `verified` — so an
// attempt to write one is a refusal rather than a silent rewrite.
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
/** Create the worker's own private preparation record for a contact. */
export const createPrivatePreparationInput = z.strictObject({
  displayName: z.string().trim().min(1, "A preparation record needs a name to recognise the contact by.").max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds."),
  contactMethods: z.array(contactMethodInputSchema).max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.").optional(),
  note: noteBodySchema.optional(),
});
/** Change the permitted fields of one partner record. */
export const saveContactEditsInput = z.strictObject({
  partnerId: opaqueIdSchema,
  displayName: z.string().trim().min(1, "A display name cannot be blank.").max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds.").optional(),
  nameParts: namePartsInputSchema.optional(),
  contactMethods: z.array(contactMethodInputSchema).max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.").optional(),
  restrictions: z.array(restrictionInputSchema).max(RESTRICTIONS_MAX_COUNT, "A record stores at most twenty restrictions.").optional(),
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
/** Record one interaction that actually happened. */
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
          message: "Unknown precision states that the day is not known, so it carries no date. Nothing is guessed to fill one in.",
        });
      }
      if (value.precision !== "unknown" && value.date === undefined) {
        context.addIssue({
          code: "custom",
          path: ["date"],
          message: "State the day this interaction happened on, or record the precision as unknown.",
        });
      }
    }),
  outcome: z.string().trim().min(1, "Say what came of the contact.").max(OUTCOME_MAX_LENGTH, "This outcome statement is longer than a stored record holds."),
  participants: z
    .array(
      z.strictObject({
        partnerId: opaqueIdSchema,
        role: z.string().trim().min(1, "Say how this person took part.").max(PARTICIPANT_ROLE_MAX_LENGTH, "This participant role is longer than a stored record holds."),
      }),
    )
    .min(1, "Name at least one person who took part.")
    .max(PARTICIPANTS_MAX_COUNT, "An interaction records at most twenty participants."),
  note: noteBodySchema.optional(),
  provenance: sourceReferenceSchema.optional(),
});
// The stored records these mutations read and write
const storedPartnerRecordSchema = partnerRecordSchema.and(z.object({ archived: z.boolean().optional() }));

type StoredPartnerRecord = z.infer<typeof storedPartnerRecordSchema>;

const storedSavedViewSchema = z.object({
  viewId: z.string().min(1),
  name: z.string().min(1),
  query: storedSavedViewQuerySchema,
  ownerPrincipalId: principalIdSchema,
  revision: recordRevisionSchema,
});
type StoredSavedView = z.infer<typeof storedSavedViewSchema>;

type StoredSavedViewQuery = z.infer<typeof storedSavedViewQuerySchema>;

type SavedViewQueryInput = z.infer<typeof savedViewQuerySchema>;

type ContactMethodInput = z.infer<typeof contactMethodInputSchema>;

type NamePartsInput = z.infer<typeof namePartsInputSchema>;

type RestrictionInput = z.infer<typeof restrictionInputSchema>;

const stateDocumentSchema = z.looseObject({
  partners: z.array(storedPartnerRecordSchema).default([]),
  privateNotes: z.array(privateNoteRecordSchema).default([]),
  interactions: z.array(interactionRecordSchema).default([]),
  savedViews: z.array(storedSavedViewSchema).default([]),
});
type StateDocument = z.infer<typeof stateDocumentSchema>;

type StateFamily = "partners" | "privateNotes" | "interactions" | "savedViews";
// What these mutations report
//
// One exact shape per job, so a replayed operation returns the same identifiers it first returned and
// no caller has to interpret an optional member to know what happened.
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
// Running one mutation
const UNIDENTIFIED_ATTEMPT = "unidentified-attempt";

function attemptIdOf(input: unknown): string {
  if (typeof input === "object" && input !== null) {
    const candidate: unknown = Reflect.get(input, "operationId");
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return UNIDENTIFIED_ATTEMPT;
}
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
function payloadOf<S extends z.ZodType>(schema: S, input: MutationInput<unknown>): z.output<S> {
  return schema.parse(input.payload);
}
// Authority
const ADMISSION_ESTABLISHES_AUTHORITY: (session: ResolvedSession) => ScopeDecision = () => ({
  ok: true,
});
function authorityOf(decision: AccessDecision): ScopeDecision {
  return decision.allowed ? { ok: true } : { ok: false, denial: decision.denial };
}
function ownPreparationTarget(scope: Scope, session: ResolvedSession): AuthorizationTarget {
  return { kind: "partner", scope, audience: "private", authorPrincipalId: session.principalId };
}
function partnerTarget(scope: Scope, session: ResolvedSession, record: PartnerRecord): AuthorizationTarget {
  return {
    kind: "partner",
    scope,
    audience: record.audience,
    authorPrincipalId: record.audience === "private" ? session.principalId : null,
  };
}
function ownPrivateNoteTarget(scope: Scope, session: ResolvedSession): AuthorizationTarget {
  return { kind: "private-note", scope, authorPrincipalId: session.principalId };
}
function interactionTarget(scope: Scope): AuthorizationTarget {
  return { kind: "interaction", scope };
}
// Reading and writing the session's records
const STORE_CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";

function unreadableState(detail: string): Error {
  const error = new Error(`This session's records cannot be read: ${detail}. Nothing was written. Reset the development data from Settings to rebuild the session's documents deterministically.`);
  error.name = STORE_CORRUPT_DOCUMENT_FAULT;
  return error;
}
function stateDocumentOf(docs: MutationContext["docs"]): StateDocument {
  const parsed = stateDocumentSchema.safeParse(docs.state);
  if (!parsed.success) {
    throw unreadableState("a record family in the state document is not readable");
  }
  return parsed.data;
}
function writeState(docs: MutationContext["docs"], state: StateDocument, change: Partial<Record<StateFamily, unknown>>): void {
  docs.state = { ...state, ...change };
}
function partnerOf(state: StateDocument, partnerId: string): StoredPartnerRecord | undefined {
  return state.partners.find((record) => record.partnerId === partnerId);
}
function withPartner(state: StateDocument, next: StoredPartnerRecord): readonly StoredPartnerRecord[] {
  return state.partners.map((record) => (record.partnerId === next.partnerId ? next : record));
}
function savedViewOf(state: StateDocument, viewId: string): StoredSavedView | undefined {
  return state.savedViews.find((view) => view.viewId === viewId);
}
// Comparing what a change would produce with what is stored
function sameNameParts(left: PartnerNameParts | null, right: PartnerNameParts | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.given === right.given && left.family === right.family && left.additional.length === right.additional.length && left.additional.every((part, index) => part === right.additional[index]);
}
function sameContactMethods(left: readonly PartnerContactMethod[], right: readonly PartnerContactMethod[]): boolean {
  return (
    left.length === right.length &&
    left.every((method, index) => {
      const other = right[index];
      return other !== undefined && other.kind === method.kind && other.value === method.value && other.permitted === method.permitted;
    })
  );
}
function sameRestrictions(left: readonly PartnerRestriction[], right: readonly PartnerRestriction[]): boolean {
  return (
    left.length === right.length &&
    left.every((restriction, index) => {
      const other = right[index];
      return other !== undefined && other.kind === restriction.kind && other.detail === restriction.detail;
    })
  );
}
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
    ...(query.sort === undefined ? {} : { sort: { field: query.sort.field, direction: query.sort.direction } }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
  };
}
function sameQuery(left: StoredSavedViewQuery, right: StoredSavedViewQuery): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
// Building the stored values a payload describes
function newRecordId(): string {
  return globalThis.crypto.randomUUID();
}
function nextRevision(): string {
  return globalThis.crypto.randomUUID();
}
function contactMethodsOf(methods: readonly ContactMethodInput[]): readonly PartnerContactMethod[] {
  return methods.map((method) => ({
    kind: method.kind,
    value: method.value,
    permitted: method.permitted,
    verified: false,
  }));
}
function namePartsOf(parts: NamePartsInput): PartnerNameParts {
  return { given: parts.given, family: parts.family, additional: [...parts.additional] };
}
function restrictionsOf(restrictions: readonly RestrictionInput[]): readonly PartnerRestriction[] {
  return restrictions.map((restriction) => ({
    kind: restriction.kind,
    detail: restriction.detail,
  }));
}
function recordedAt(): string {
  return now().toString();
}
// The payload types these mutations accept
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
// Locating the record an attempt names
const ABSENT_TARGET: CurrentTarget = { kind: "absent" };

const NOTHING_TO_CHANGE = { changed: false } as const;

function refuseDenied(operationId: string): { readonly refused: MutationOutcome } {
  return { refused: denied({ operationId, reasonCode: "no-permission" }) };
}
function memberOf(payload: unknown, member: string): unknown {
  return typeof payload === "object" && payload !== null ? Reflect.get(payload, member) : undefined;
}
function partnerIdOf(input: MutationInput<unknown>): string {
  const candidate = memberOf(input.payload, "partnerId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "";
}
function savedViewIdOf(input: MutationInput<unknown>): string | undefined {
  const candidate = memberOf(input.payload, "viewId");
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}
function partnerCurrentTarget(docs: MutationContext["docs"], partnerId: string): CurrentTarget {
  const record = partnerOf(stateDocumentOf(docs), partnerId);
  return record === undefined ? ABSENT_TARGET : { kind: "record", revision: record.revision, value: record };
}
function savedViewCurrentTarget(docs: MutationContext["docs"], viewId: string | undefined, principalId: string): CurrentTarget {
  if (viewId === undefined) {
    return ABSENT_TARGET;
  }
  const view = savedViewOf(stateDocumentOf(docs), viewId);
  if (view === undefined || view.ownerPrincipalId !== principalId) {
    return ABSENT_TARGET;
  }
  return { kind: "record", revision: view.revision, value: view };
}
function samePermittedFields(current: PartnerRecord, next: PartnerRecord): boolean {
  return (
    current.displayName === next.displayName &&
    sameNameParts(current.nameParts, next.nameParts) &&
    sameContactMethods(current.contactMethods, next.contactMethods) &&
    sameRestrictions(current.restrictions, next.restrictions) &&
    current.stage === next.stage
  );
}
// Saved views
/** Saves a new saved view for the caller, or replaces a view the caller already owns. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function saveView(input: MutationInput<SaveViewInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SaveViewInput, ViewChangeResult>(input, source, {
    name: "saveView",
    schema: saveViewInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => savedViewCurrentTarget(docs, savedViewIdOf(input), input.scope.principalId),
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
        savedViews: state.savedViews.map((candidate) => (candidate.viewId === replaced.viewId ? replaced : candidate)),
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
/** Renames one saved view the caller owns. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function renameView(input: MutationInput<RenameViewInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<RenameViewInput, ViewChangeResult>(input, source, {
    name: "renameView",
    schema: renameViewInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => savedViewCurrentTarget(docs, savedViewIdOf(input), input.scope.principalId),
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
        savedViews: state.savedViews.map((candidate) => (candidate.viewId === renamed.viewId ? renamed : candidate)),
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
/** Deletes one saved view the caller owns; no record is touched by deleting a view. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function deleteView(input: MutationInput<DeleteViewInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<DeleteViewInput, ViewChangeResult>(input, source, {
    name: "deleteView",
    schema: deleteViewInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => savedViewCurrentTarget(docs, savedViewIdOf(input), input.scope.principalId),
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
// Personal filing: tags and favourites
/** Applies or removes one personal tag on one partner record. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function setTag(input: MutationInput<SetTagInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SetTagInput, PartnerTagChangeResult>(input, source, {
    name: "setTag",
    schema: setTagInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(setTagInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || !canEdit(session, partnerTarget(input.scope, session, record)).allowed) {
        return refuseDenied(operationId);
      }
      const held = record.tags.includes(payload.tag);
      if (held === payload.present) {
        return NOTHING_TO_CHANGE;
      }
      const tags = payload.present ? [...record.tags, payload.tag] : record.tags.filter((tag) => tag !== payload.tag);
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
/** Marks one partner record as a favourite, or clears the mark. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function setFavourite(input: MutationInput<SetFavouriteInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SetFavouriteInput, PartnerChangeResult>(input, source, {
    name: "setFavourite",
    schema: setFavouriteInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(setFavouriteInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || !canEdit(session, partnerTarget(input.scope, session, record)).allowed) {
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
// Private preparation: creation, contact edits, archive and restore
/** Creates the worker's own private preparation record for a contact, with its opening note if one is given. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function createPrivatePreparation(input: MutationInput<CreatePrivatePreparationInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<CreatePrivatePreparationInput, PartnerPreparationResult>(input, source, {
    name: "createPrivatePreparation",
    schema: createPrivatePreparationInput,
    authorize: (session) => authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
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
  });
}
/** Changes the permitted fields of one partner record: its display name and name parts, its contact methods with their own `permitted` flag, its restrictions and its relationship label. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function saveContactEdits(input: MutationInput<SaveContactEditsInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SaveContactEditsInput, PartnerChangeResult>(input, source, {
    name: "saveContactEdits",
    schema: saveContactEditsInput,
    authorize: ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(saveContactEditsInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || !canEdit(session, partnerTarget(input.scope, session, record)).allowed) {
        return refuseDenied(operationId);
      }
      const next: StoredPartnerRecord = {
        ...record,
        displayName: payload.displayName ?? record.displayName,
        nameParts: payload.nameParts === undefined ? record.nameParts : namePartsOf(payload.nameParts),
        contactMethods: payload.contactMethods === undefined ? record.contactMethods : contactMethodsOf(payload.contactMethods),
        restrictions: payload.restrictions === undefined ? record.restrictions : restrictionsOf(payload.restrictions),
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
/** Archives one private preparation record: it leaves the working lists and nothing is deleted. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function archivePreparation(input: MutationInput<ArchivePreparationInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<ArchivePreparationInput, PartnerChangeResult>(input, source, {
    name: "archivePreparation",
    schema: archivePreparationInput,
    authorize: (session) => authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(archivePreparationInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || record.kind !== "private-preparation" || record.audience !== "private" || !canEdit(session, partnerTarget(input.scope, session, record)).allowed) {
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
/** Restores one archived private preparation record to the working lists. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function restorePreparation(input: MutationInput<RestorePreparationInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<RestorePreparationInput, PartnerChangeResult>(input, source, {
    name: "restorePreparation",
    schema: restorePreparationInput,
    authorize: (session) => authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
    readCurrent: (docs) => partnerCurrentTarget(docs, partnerIdOf(input)),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(restorePreparationInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || record.kind !== "private-preparation" || record.audience !== "private" || !canEdit(session, partnerTarget(input.scope, session, record)).allowed) {
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
// Recorded activity
/** Writes one private note about one partner record. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function savePrivateNote(input: MutationInput<SavePrivateNoteInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SavePrivateNoteInput, NoteChangeResult>(input, source, {
    name: "savePrivateNote",
    schema: savePrivateNoteInput,
    authorize: (session) => authorityOf(canEdit(session, ownPrivateNoteTarget(input.scope, session))),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(savePrivateNoteInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || !canView(session, partnerTarget(input.scope, session, record)).allowed) {
        return refuseDenied(operationId);
      }
      const alreadyWritten = state.privateNotes.some((note) => note.partnerId === record.partnerId && note.authorPrincipalId === session.principalId && note.body === payload.body);
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
/** Records one interaction that actually happened with a partner. Outcomes are `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export async function logInteraction(input: MutationInput<LogInteractionInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<LogInteractionInput, InteractionChangeResult>(input, source, {
    name: "logInteraction",
    schema: logInteractionInput,
    authorize: (session) => authorityOf(canEdit(session, interactionTarget(input.scope))),
    apply: ({ docs, session, operationId }) => {
      const payload = payloadOf(logInteractionInput, input);
      const state = stateDocumentOf(docs);
      const record = partnerOf(state, payload.partnerId);
      if (record === undefined || !canView(session, partnerTarget(input.scope, session, record)).allowed) {
        return refuseDenied(operationId);
      }
      const provenance: SourceReference | null = payload.provenance ?? null;
      if (provenance !== null && state.interactions.some((interaction) => interaction.provenance !== null && sameSourceReference(interaction.provenance, provenance))) {
        // The source recorded this event once already, so a second record of it would state that it
        // happened twice. The stored record is what the source stands behind, and it is left as it is.
        return NOTHING_TO_CHANGE;
      }
      const participants: readonly InteractionParticipant[] = payload.participants.map((participant) => ({
        role: participant.role,
        partnerId: partnerOf(state, participant.partnerId)?.partnerId ?? null,
        principalId: null,
      }));
      if (participants.some((participant) => participant.partnerId === null)) {
        // A participant this context holds no record of would point at nothing. Guessing a person from
        // a name is exactly the identity inference this application refuses, so nothing is recorded.
        return NOTHING_TO_CHANGE;
      }
      const note: InteractionNote | null = payload.note === undefined ? null : { body: payload.note, audience: "private" };
      const interaction: InteractionRecord = {
        interactionId: newRecordId(),
        partnerId: record.partnerId,
        type: payload.type,
        occurredOn: payload.occurredOn.precision === "unknown" ? null : (payload.occurredOn.date ?? null),
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
