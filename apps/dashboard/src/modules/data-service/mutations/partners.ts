import { z } from "zod";
import { sameSourceReference, type SourceReference } from "@/lib/ids";
import { now } from "@/modules/time/clock";
import { DATE_PRECISIONS, parseCivilDate } from "@/modules/time/civil";
import { canEdit, canView, type AccessDecision, type AuthorizationTarget, type ResolvedSession, type ScopeDecision, type SessionSource } from "../authorize";
import { CONTACT_METHOD_KINDS, interactionRecordSchema, partnerRecordSchema, privateNoteRecordSchema, principalIdSchema, recordRevisionSchema, sessionContextRecordSchema, sourceReferenceSchema } from "../envelope";
import type { InteractionNote, InteractionParticipant, InteractionRecord, MutationInput, PartnerContactMethod, PartnerNameParts, PartnerRecord, PartnerRestriction, PrincipalId, PrivateNoteRecord, Scope, StoredRecord } from "../envelope";
import { openMutation, payloadOf, refuseDenied, runMutation, type ApplyResult, type CurrentTarget, type MutationContext, type MutationName } from "../operations";
import type { MutationOutcome, MutationResult } from "../outcome";
export const INTERACTION_KINDS = ["conversation", "visit", "call", "meeting", "written-exchange", "other"] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];
const OPAQUE_ID_MAX_LENGTH = 160,
  VIEW_NAME_MAX_LENGTH = 80,
  SEARCH_TEXT_MAX_LENGTH = 200,
  FACET_ID_MAX_LENGTH = 80,
  FACET_VALUE_MAX_LENGTH = 160,
  FACET_VALUES_MAX_COUNT = 200,
  PAGE_SIZE_CAP = 200,
  DISPLAY_NAME_MAX_LENGTH = 200;
const ADDITIONAL_NAME_MAX_LENGTH = 120,
  ADDITIONAL_NAMES_MAX_COUNT = 8,
  CONTACT_VALUE_MAX_LENGTH = 320,
  CONTACT_METHODS_MAX_COUNT = 30,
  STAGE_MAX_LENGTH = 80,
  RESTRICTION_KIND_MAX_LENGTH = 80;
const RESTRICTION_DETAIL_MAX_LENGTH = 1_000,
  RESTRICTIONS_MAX_COUNT = 20,
  TAG_MAX_LENGTH = 40,
  OUTCOME_MAX_LENGTH = 500,
  PARTICIPANT_ROLE_MAX_LENGTH = 80,
  PARTICIPANTS_MAX_COUNT = 20,
  NOTE_BODY_MAX_LENGTH = 4_000;
const boundedText = (maximum: number, required: string, tooLong: string): z.ZodString => z.string().trim().min(1, required).max(maximum, tooLong);
const opaqueIdSchema = boundedText(OPAQUE_ID_MAX_LENGTH, "Name the record this change applies to: an empty identifier names nothing.", `An identifier is at most ${String(OPAQUE_ID_MAX_LENGTH)} characters, and the value supplied is longer.`);
const civilDateFieldSchema = z.string().refine((value) => parseCivilDate(value).status === "parsed", "State the day as YYYY-MM-DD. It is read as a calendar day, so a time, a zone or a day that does not exist cannot be understood.");
const contactMethodInputSchema = z.strictObject({
  kind: z.enum(CONTACT_METHOD_KINDS, "Choose a contact method kind: email, phone or postal."),
  value: z.string().trim().min(1, "A contact method needs a value.").max(CONTACT_VALUE_MAX_LENGTH, "This contact method value is longer than a stored record holds."),
  permitted: z.boolean(),
});
const namePartsInputSchema = z.strictObject({
  given: z.string().trim().min(1, "A recorded given name cannot be blank.").nullable(),
  family: z.string().trim().min(1, "A recorded family name cannot be blank.").nullable(),
  additional: z.array(z.string().trim().min(1, "A recorded additional name cannot be blank.").max(ADDITIONAL_NAME_MAX_LENGTH, "This additional name part is longer than a stored record holds.")).max(ADDITIONAL_NAMES_MAX_COUNT, "A name stores at most eight additional parts."),
});
const restrictionInputSchema = z.strictObject({
  kind: z.string().trim().min(1, "A restriction needs a short label.").max(RESTRICTION_KIND_MAX_LENGTH, "This restriction label is longer than a stored record holds."),
  detail: z.string().trim().min(1, "A restriction states what must not happen.").max(RESTRICTION_DETAIL_MAX_LENGTH, "This restriction detail is longer than a stored record holds."),
});
const tagSchema = boundedText(TAG_MAX_LENGTH, "A tag needs at least one visible character.", `A tag is at most ${String(TAG_MAX_LENGTH)} characters.`);
const noteBodySchema = boundedText(NOTE_BODY_MAX_LENGTH, "A note needs at least one visible character.", `A note is at most ${String(NOTE_BODY_MAX_LENGTH)} characters; nothing is truncated, so a longer note must be shortened deliberately.`);
const viewNameSchema = boundedText(VIEW_NAME_MAX_LENGTH, "A saved view needs a name.", `A saved view name is at most ${String(VIEW_NAME_MAX_LENGTH)} characters.`);
const savedViewQueryFields = {
  search: z.string().max(SEARCH_TEXT_MAX_LENGTH, "The stored search text is longer than a saved view holds."),
  applied: z.record(z.string().min(1).max(FACET_ID_MAX_LENGTH), z.array(z.string().min(1).max(FACET_VALUE_MAX_LENGTH)).max(FACET_VALUES_MAX_COUNT, "One facet stores at most two hundred selected values.")),
  columnVisibility: z.record(z.string().min(1).max(FACET_ID_MAX_LENGTH), z.boolean()).optional(),
  sort: z.strictObject({ field: z.string().min(1).max(FACET_ID_MAX_LENGTH), direction: z.enum(["asc", "desc"], "A stored sort runs ascending or descending.") }).optional(),
  pageSize: z.int().min(1).max(PAGE_SIZE_CAP).optional(),
} as const;
const savedViewQuerySchema = z.strictObject(savedViewQueryFields),
  storedSavedViewQuerySchema = z.object(savedViewQueryFields);
export const saveViewInput = z.strictObject({ name: viewNameSchema, queryState: savedViewQuerySchema, viewId: opaqueIdSchema.optional() });
export const renameViewInput = z.strictObject({ viewId: opaqueIdSchema, name: viewNameSchema });
export const deleteViewInput = z.strictObject({ viewId: opaqueIdSchema });
export const setTagInput = z.strictObject({ partnerId: opaqueIdSchema, tag: tagSchema, present: z.boolean() });
export const setFavouriteInput = z.strictObject({ partnerId: opaqueIdSchema, favourite: z.boolean() });
export const createPrivatePreparationInput = z.strictObject({
  displayName: z.string().trim().min(1, "A preparation record needs a name to recognise the contact by.").max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds."),
  contactMethods: z.array(contactMethodInputSchema).max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.").optional(),
  note: noteBodySchema.optional(),
});
export const saveContactEditsInput = z.strictObject({
  partnerId: opaqueIdSchema,
  displayName: z.string().trim().min(1, "A display name cannot be blank.").max(DISPLAY_NAME_MAX_LENGTH, "This display name is longer than a stored record holds.").optional(),
  nameParts: namePartsInputSchema.optional(),
  contactMethods: z.array(contactMethodInputSchema).max(CONTACT_METHODS_MAX_COUNT, "A record stores at most thirty contact methods.").optional(),
  restrictions: z.array(restrictionInputSchema).max(RESTRICTIONS_MAX_COUNT, "A record stores at most twenty restrictions.").optional(),
  stage: z.string().trim().min(1, "A relationship label cannot be blank; send null to clear it.").max(STAGE_MAX_LENGTH, "This relationship label is longer than a stored record holds.").nullable().optional(),
});
export const archivePreparationInput = z.strictObject({ partnerId: opaqueIdSchema });
export const restorePreparationInput = z.strictObject({ partnerId: opaqueIdSchema });
export const savePrivateNoteInput = z.strictObject({ partnerId: opaqueIdSchema, body: noteBodySchema });
export const logInteractionInput = z.strictObject({
  partnerId: opaqueIdSchema,
  type: z.enum(INTERACTION_KINDS, "Choose the kind of contact that took place."),
  occurredOn: z.strictObject({ precision: z.enum(DATE_PRECISIONS, "State how precisely the day is known."), date: civilDateFieldSchema.optional() }).superRefine((value, context) => {
    if (value.precision === "unknown" && value.date !== undefined) context.addIssue({ code: "custom", path: ["date"], message: "Unknown precision states that the day is not known, so it carries no date. Nothing is guessed to fill one in." });
    if (value.precision !== "unknown" && value.date === undefined) context.addIssue({ code: "custom", path: ["date"], message: "State the day this interaction happened on, or record the precision as unknown." });
  }),
  outcome: z.string().trim().min(1, "Say what came of the contact.").max(OUTCOME_MAX_LENGTH, "This outcome statement is longer than a stored record holds."),
  participants: z
    .array(z.strictObject({ partnerId: opaqueIdSchema, role: z.string().trim().min(1, "Say how this person took part.").max(PARTICIPANT_ROLE_MAX_LENGTH, "This participant role is longer than a stored record holds.") }))
    .min(1, "Name at least one person who took part.")
    .max(PARTICIPANTS_MAX_COUNT, "An interaction records at most twenty participants."),
  note: noteBodySchema.optional(),
  provenance: sourceReferenceSchema.optional(),
});
const storedPartnerRecordSchema = partnerRecordSchema.and(z.object({ archived: z.boolean().optional() }));
type StoredPartnerRecord = StoredRecord<z.infer<typeof storedPartnerRecordSchema>>;
const storedSavedViewSchema = z.object({ viewId: z.string().min(1), name: z.string().min(1), query: storedSavedViewQuerySchema, ownerPrincipalId: principalIdSchema, revision: recordRevisionSchema });
type StoredSavedView = StoredRecord<z.infer<typeof storedSavedViewSchema>>;
type StoredSavedViewQuery = StoredRecord<z.infer<typeof storedSavedViewQuerySchema>>;
type SavedViewQueryInput = z.infer<typeof savedViewQuerySchema>;
type ContactMethodInput = z.infer<typeof contactMethodInputSchema>;
type NamePartsInput = z.infer<typeof namePartsInputSchema>;
type RestrictionInput = z.infer<typeof restrictionInputSchema>;
// The session's own record of who it is, decoded here as the reads decode it: a private record's author is compared with the principal this document states, so both sides of that comparison read the same stored fact.
const stateDocumentSchema = z.looseObject({ context: sessionContextRecordSchema, partners: z.array(storedPartnerRecordSchema).default([]), privateNotes: z.array(privateNoteRecordSchema).default([]), interactions: z.array(interactionRecordSchema).default([]), savedViews: z.array(storedSavedViewSchema).default([]) });
type StateDocument = StoredRecord<z.infer<typeof stateDocumentSchema>>;
type StateFamily = "partners" | "privateNotes" | "interactions" | "savedViews";
export type PartnerChangeResult = { readonly partnerId: string; readonly revision: string };
export type PartnerTagChangeResult = { readonly partnerId: string; readonly revision: string; readonly tags: readonly string[] };
export type PartnerPreparationResult = { readonly partnerId: string; readonly revision: string; readonly note: { readonly noteId: string; readonly revision: string } | null };
export type NoteChangeResult = { readonly partnerId: string; readonly noteId: string; readonly revision: string };
export type InteractionChangeResult = { readonly partnerId: string; readonly interactionId: string; readonly revision: string };
export type ViewChangeResult = { readonly viewId: string; readonly revision: string };
type PartnerSpec<P, R extends MutationResult> = {
  readonly name: MutationName;
  readonly schema: z.ZodType<P>;
  readonly authorize?: (session: ResolvedSession) => ScopeDecision;
  readonly readCurrent?: (documents: MutationContext["docs"], payload: P) => CurrentTarget;
  readonly apply: (context: MutationContext, payload: P, scope: Scope) => ApplyResult<R>;
};
async function runPartnerMutation<P, R extends MutationResult>(input: MutationInput<P>, source: SessionSource | undefined, spec: PartnerSpec<P, R>): Promise<MutationOutcome> {
  const opening = await openMutation(spec.name, input, source);
  if (!opening.ok) return opening.outcome;
  const payload = (): P => payloadOf(spec.schema, input);
  return runMutation<P, R>({
    sessionId: opening.sessionId,
    input,
    schema: spec.schema,
    name: spec.name,
    authorize: spec.authorize ?? ADMISSION_ESTABLISHES_AUTHORITY,
    readCurrent: (documents) => (spec.readCurrent === undefined ? ABSENT_TARGET : spec.readCurrent(documents, payload())),
    apply: (context) => spec.apply(context, payload(), input.scope),
  });
}
const ADMISSION_ESTABLISHES_AUTHORITY: (session: ResolvedSession) => ScopeDecision = () => ({ ok: true });
const authorityOf = (decision: AccessDecision): ScopeDecision => (decision.allowed ? { ok: true } : { ok: false, denial: decision.denial });
const ownPreparationTarget = (scope: Scope, session: ResolvedSession): AuthorizationTarget => ({ kind: "partner", scope, audience: "private", authorPrincipalId: session.principalId });
// A private record's author is the principal its own session document records, as the read path states it. Asserting the caller instead would satisfy the resolver's private-author test by construction, so a record from another principal's world could be changed by anyone admitted to the scope.
const partnerTarget = (scope: Scope, record: PartnerRecord, authorPrincipalId: PrincipalId): AuthorizationTarget => ({ kind: "partner", scope, audience: record.audience, authorPrincipalId: record.audience === "private" ? authorPrincipalId : null });
const ownPrivateNoteTarget = (scope: Scope, session: ResolvedSession): AuthorizationTarget => ({ kind: "private-note", scope, authorPrincipalId: session.principalId }),
  interactionTarget = (scope: Scope): AuthorizationTarget => ({ kind: "interaction", scope });
const STORE_CORRUPT_DOCUMENT_FAULT = "CorruptJsonError";
const unreadableState = (detail: string): Error => Object.assign(new Error(`This session's records cannot be read: ${detail}. Nothing was written. Reset the development data from Settings to rebuild the session's documents deterministically.`), { name: STORE_CORRUPT_DOCUMENT_FAULT });
function stateDocumentOf(docs: MutationContext["docs"]): StateDocument {
  const parsed = stateDocumentSchema.safeParse(docs.state);
  if (!parsed.success) throw unreadableState("a record family in the state document is not readable");
  return parsed.data;
}
function writeState(docs: MutationContext["docs"], state: StateDocument, change: Partial<Record<StateFamily, unknown>>): void {
  docs.state = { ...state, ...change };
}
const partnerOf = (state: StateDocument, partnerId: string): StoredPartnerRecord | undefined => state.partners.find((record) => record.partnerId === partnerId);
const withPartner = (state: StateDocument, next: StoredPartnerRecord): readonly StoredPartnerRecord[] => state.partners.map((record) => (record.partnerId === next.partnerId ? next : record));
const savedViewOf = (state: StateDocument, viewId: string): StoredSavedView | undefined => state.savedViews.find((view) => view.viewId === viewId);
function sameNameParts(left: PartnerNameParts | null, right: PartnerNameParts | null): boolean {
  return left === null || right === null ? left === right : left.given === right.given && left.family === right.family && left.additional.length === right.additional.length && left.additional.every((part, index) => part === right.additional[index]);
}
const sameSequence = <T>(left: readonly T[], right: readonly T[], same: (one: T, other: T) => boolean): boolean => left.length === right.length && left.every((one, index) => right[index] !== undefined && same(one, right[index]));
const sameContactMethods = (left: readonly PartnerContactMethod[], right: readonly PartnerContactMethod[]): boolean => sameSequence(left, right, (one, other) => one.kind === other.kind && one.value === other.value && one.permitted === other.permitted);
const sameRestrictions = (left: readonly PartnerRestriction[], right: readonly PartnerRestriction[]): boolean => sameSequence(left, right, (one, other) => one.kind === other.kind && one.detail === other.detail);
function storedQueryOf(query: SavedViewQueryInput): StoredSavedViewQuery {
  const applied: Record<string, string[]> = {},
    columnVisibility: Record<string, boolean> = {};
  for (const facetId of Object.keys(query.applied).sort()) if ((query.applied[facetId]?.length ?? 0) > 0) applied[facetId] = [...(query.applied[facetId] ?? [])].sort();
  for (const columnId of Object.keys(query.columnVisibility ?? {}).sort()) {
    const visible = query.columnVisibility?.[columnId];
    if (visible !== undefined) columnVisibility[columnId] = visible;
  }
  return { search: query.search, applied, ...(Object.keys(columnVisibility).length === 0 ? {} : { columnVisibility }), ...(query.sort === undefined ? {} : { sort: { field: query.sort.field, direction: query.sort.direction } }), ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }) };
}
const sameQuery = (left: StoredSavedViewQuery, right: StoredSavedViewQuery): boolean => JSON.stringify(left) === JSON.stringify(right);
const newRecordId = (): string => globalThis.crypto.randomUUID(),
  nextRevision = (): string => globalThis.crypto.randomUUID();
const contactMethodsOf = (methods: readonly ContactMethodInput[]): readonly PartnerContactMethod[] => methods.map((method) => ({ kind: method.kind, value: method.value, permitted: method.permitted, verified: false }));
const namePartsOf = (parts: NamePartsInput): PartnerNameParts => ({ given: parts.given, family: parts.family, additional: [...parts.additional] });
const restrictionsOf = (restrictions: readonly RestrictionInput[]): readonly PartnerRestriction[] => restrictions.map((restriction) => ({ kind: restriction.kind, detail: restriction.detail })),
  recordedAt = (): string => now().toString();
export type SaveViewInput = z.output<typeof saveViewInput>;
export type RenameViewInput = z.output<typeof renameViewInput>;
export type DeleteViewInput = z.output<typeof deleteViewInput>;
export type SetTagInput = z.output<typeof setTagInput>;
export type SetFavouriteInput = z.output<typeof setFavouriteInput>;
export type CreatePrivatePreparationInput = z.output<typeof createPrivatePreparationInput>;
export type SaveContactEditsInput = z.output<typeof saveContactEditsInput>;
export type ArchivePreparationInput = z.output<typeof archivePreparationInput>;
export type RestorePreparationInput = z.output<typeof restorePreparationInput>;
export type SavePrivateNoteInput = z.output<typeof savePrivateNoteInput>;
export type LogInteractionInput = z.output<typeof logInteractionInput>;
const ABSENT_TARGET: CurrentTarget = { kind: "absent" };
const NOTHING_TO_CHANGE = { changed: false } as const;
const partnerCurrentTarget = (docs: MutationContext["docs"], partnerId: string): CurrentTarget => {
  const record = partnerOf(stateDocumentOf(docs), partnerId);
  return record === undefined ? ABSENT_TARGET : { kind: "record", revision: record.revision, value: record };
};
function savedViewCurrentTarget(docs: MutationContext["docs"], viewId: string | undefined, principalId: string): CurrentTarget {
  if (viewId === undefined) return ABSENT_TARGET;
  const view = savedViewOf(stateDocumentOf(docs), viewId);
  return view === undefined || view.ownerPrincipalId !== principalId ? ABSENT_TARGET : { kind: "record", revision: view.revision, value: view };
}
const samePermittedFields = (current: PartnerRecord, next: PartnerRecord): boolean =>
  current.displayName === next.displayName && sameNameParts(current.nameParts, next.nameParts) && sameContactMethods(current.contactMethods, next.contactMethods) && sameRestrictions(current.restrictions, next.restrictions) && current.stage === next.stage;
/** Saves a new saved view for the caller, or replaces a view the caller already owns. */ export async function saveView(input: MutationInput<SaveViewInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SaveViewInput, ViewChangeResult>(input, source, { name: "saveView", schema: saveViewInput, authorize: ADMISSION_ESTABLISHES_AUTHORITY, readCurrent: (documents, payload) => savedViewCurrentTarget(documents, payload.viewId, input.scope.principalId), apply: applySaveView });
}
function storedViewChange(docs: MutationContext["docs"], state: StateDocument, replaced: StoredSavedView): ApplyResult<ViewChangeResult> {
  const revision = nextRevision();
  const next: StoredSavedView = { ...replaced, revision };
  writeState(docs, state, { savedViews: state.savedViews.map((candidate) => (candidate.viewId === next.viewId ? next : candidate)) });
  return { changed: true, revision, result: { viewId: next.viewId, revision }, changedIds: [next.viewId] };
}
function requireOwnedView(state: StateDocument, viewId: string, principalId: string, operationId: string): StoredSavedView {
  const view = savedViewOf(state, viewId);
  if (view === undefined || view.ownerPrincipalId !== principalId) return refuseDenied(operationId);
  return view;
}
function applySaveView({ docs, session, operationId }: MutationContext, payload: SaveViewInput): ApplyResult<ViewChangeResult> {
  const state = stateDocumentOf(docs);
  const query = storedQueryOf(payload.queryState);
  if (payload.viewId === undefined) {
    const viewId = newRecordId(),
      revision = nextRevision();
    const view: StoredSavedView = { viewId, name: payload.name, query, ownerPrincipalId: session.principalId, revision };
    writeState(docs, state, { savedViews: [...state.savedViews, view] });
    return { changed: true, revision, result: { viewId, revision }, created: [viewId] };
  }
  const view = requireOwnedView(state, payload.viewId, session.principalId, operationId);
  return view.name === payload.name && sameQuery(view.query, query) ? NOTHING_TO_CHANGE : storedViewChange(docs, state, { ...view, name: payload.name, query });
}
/** Renames one saved view the caller owns. */ export async function renameView(input: MutationInput<RenameViewInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<RenameViewInput, ViewChangeResult>(input, source, { name: "renameView", schema: renameViewInput, authorize: ADMISSION_ESTABLISHES_AUTHORITY, readCurrent: (documents, payload) => savedViewCurrentTarget(documents, payload.viewId, input.scope.principalId), apply: applyRenameView });
}
function applyRenameView({ docs, session, operationId }: MutationContext, payload: RenameViewInput): ApplyResult<ViewChangeResult> {
  const state = stateDocumentOf(docs);
  const view = requireOwnedView(state, payload.viewId, session.principalId, operationId);
  return view.name === payload.name ? NOTHING_TO_CHANGE : storedViewChange(docs, state, { ...view, name: payload.name });
}
/** Deletes one saved view the caller owns; no record is touched by deleting a view. */ export async function deleteView(input: MutationInput<DeleteViewInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<DeleteViewInput, ViewChangeResult>(input, source, { name: "deleteView", schema: deleteViewInput, authorize: ADMISSION_ESTABLISHES_AUTHORITY, readCurrent: (documents, payload) => savedViewCurrentTarget(documents, payload.viewId, input.scope.principalId), apply: applyDeleteView });
}
function applyDeleteView({ docs, session, operationId }: MutationContext, payload: DeleteViewInput): ApplyResult<ViewChangeResult> {
  const state = stateDocumentOf(docs);
  const view = requireOwnedView(state, payload.viewId, session.principalId, operationId);
  writeState(docs, state, { savedViews: state.savedViews.filter((candidate) => candidate.viewId !== view.viewId) });
  return { changed: true, revision: view.revision, result: { viewId: view.viewId, revision: view.revision }, changedIds: [view.viewId] };
}
/** Applies or removes one personal tag on one partner record. */ export async function setTag(input: MutationInput<SetTagInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SetTagInput, PartnerTagChangeResult>(input, source, { name: "setTag", schema: setTagInput, authorize: ADMISSION_ESTABLISHES_AUTHORITY, readCurrent: (documents, payload) => partnerCurrentTarget(documents, payload.partnerId), apply: applySetTag });
}
function editPartner<Result extends MutationResult>(context: MutationContext, scope: Scope, partnerId: string, change: (record: StoredPartnerRecord) => Partial<StoredPartnerRecord> | null, answer: (next: StoredPartnerRecord) => Result): ApplyResult<Result> {
  const state = stateDocumentOf(context.docs);
  const record = partnerOf(state, partnerId);
  if (record === undefined || !canEdit(context.session, partnerTarget(scope, record, state.context.principalId)).allowed) return refuseDenied(context.operationId);
  const changed = change(record);
  if (changed === null) return NOTHING_TO_CHANGE;
  const next: StoredPartnerRecord = { ...record, ...changed, revision: nextRevision() };
  writeState(context.docs, state, { partners: withPartner(state, next) });
  return { changed: true, revision: next.revision, result: answer(next), changedIds: [next.partnerId] };
}
function applySetTag(context: MutationContext, payload: SetTagInput, scope: Scope): ApplyResult<PartnerTagChangeResult> {
  const present = payload.present;
  return editPartner(
    context,
    scope,
    payload.partnerId,
    (record) => (record.tags.includes(payload.tag) === present ? null : { tags: present ? [...record.tags, payload.tag] : record.tags.filter((tag) => tag !== payload.tag) }),
    (next) => ({ partnerId: next.partnerId, revision: next.revision, tags: next.tags }),
  );
}
/** Marks one partner record as a favourite, or clears the mark. */ export async function setFavourite(input: MutationInput<SetFavouriteInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SetFavouriteInput, PartnerChangeResult>(input, source, { name: "setFavourite", schema: setFavouriteInput, authorize: ADMISSION_ESTABLISHES_AUTHORITY, readCurrent: (documents, payload) => partnerCurrentTarget(documents, payload.partnerId), apply: applySetFavourite });
}
function applySetFavourite(context: MutationContext, payload: SetFavouriteInput, scope: Scope): ApplyResult<PartnerChangeResult> {
  return editPartner(
    context,
    scope,
    payload.partnerId,
    (record) => (record.favourite === payload.favourite ? null : { favourite: payload.favourite }),
    (next) => ({ partnerId: next.partnerId, revision: next.revision }),
  );
}
/** Creates the worker's own private preparation record for a contact, with its opening note if one is given. */
export async function createPrivatePreparation(input: MutationInput<CreatePrivatePreparationInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<CreatePrivatePreparationInput, PartnerPreparationResult>(input, source, { name: "createPrivatePreparation", schema: createPrivatePreparationInput, authorize: (session) => authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))), apply: applyCreatePrivatePreparation });
}
function applyCreatePrivatePreparation({ docs, session }: MutationContext, payload: CreatePrivatePreparationInput): ApplyResult<PartnerPreparationResult> {
  const state = stateDocumentOf(docs);
  const partnerId = newRecordId(),
    revision = nextRevision();
  const record: StoredPartnerRecord = { partnerId, kind: "private-preparation", displayName: payload.displayName, nameParts: null, contactMethods: contactMethodsOf(payload.contactMethods ?? []), restrictions: [], tags: [], favourite: false, stage: null, audience: "private", revision, source: null };
  if (payload.note === undefined) {
    writeState(docs, state, { partners: [...state.partners, record] });
    return { changed: true, revision, result: { partnerId, revision, note: null }, created: [partnerId] };
  }
  const note: PrivateNoteRecord = { noteId: newRecordId(), partnerId, authorPrincipalId: session.principalId, body: payload.note, audience: "private", createdAt: recordedAt(), revision: nextRevision() };
  writeState(docs, state, { partners: [...state.partners, record], privateNotes: [...state.privateNotes, note] });
  return { changed: true, revision, result: { partnerId, revision, note: { noteId: note.noteId, revision: note.revision } }, created: [partnerId, note.noteId] };
}
/** Changes the permitted fields of one partner record: its display name and name parts, its contact methods with their own `permitted` flag, its restrictions and its relationship label. */
export async function saveContactEdits(input: MutationInput<SaveContactEditsInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SaveContactEditsInput, PartnerChangeResult>(input, source, { name: "saveContactEdits", schema: saveContactEditsInput, authorize: ADMISSION_ESTABLISHES_AUTHORITY, readCurrent: (documents, payload) => partnerCurrentTarget(documents, payload.partnerId), apply: applySaveContactEdits });
}
function applySaveContactEdits(context: MutationContext, payload: SaveContactEditsInput, scope: Scope): ApplyResult<PartnerChangeResult> {
  return editPartner(
    context,
    scope,
    payload.partnerId,
    (record) => {
      const next: StoredPartnerRecord = {
        ...record,
        displayName: payload.displayName ?? record.displayName,
        nameParts: payload.nameParts === undefined ? record.nameParts : namePartsOf(payload.nameParts),
        contactMethods: payload.contactMethods === undefined ? record.contactMethods : contactMethodsOf(payload.contactMethods),
        restrictions: payload.restrictions === undefined ? record.restrictions : restrictionsOf(payload.restrictions),
        stage: payload.stage === undefined ? record.stage : payload.stage,
      };
      return samePermittedFields(record, next) ? null : next;
    },
    (next) => ({ partnerId: next.partnerId, revision: next.revision }),
  );
}
function applyPreparationArchive(context: MutationContext, payload: ArchivePreparationInput, scope: Scope, archived: boolean): ApplyResult<PartnerChangeResult> {
  const state = stateDocumentOf(context.docs);
  const record = partnerOf(state, payload.partnerId);
  if (record === undefined || record.kind !== "private-preparation" || record.audience !== "private" || !canEdit(context.session, partnerTarget(scope, record, state.context.principalId)).allowed) return refuseDenied(context.operationId);
  if ((record.archived === true) === archived) return NOTHING_TO_CHANGE;
  const next: StoredPartnerRecord = { ...record, archived, revision: nextRevision() };
  writeState(context.docs, state, { partners: withPartner(state, next) });
  return { changed: true, revision: next.revision, result: { partnerId: next.partnerId, revision: next.revision }, changedIds: [next.partnerId] };
}
function runPreparationArchive(input: MutationInput<ArchivePreparationInput>, source: SessionSource | undefined, name: MutationName, schema: z.ZodType<ArchivePreparationInput>, archived: boolean): Promise<MutationOutcome> {
  return runPartnerMutation<ArchivePreparationInput, PartnerChangeResult>(input, source, {
    name,
    schema,
    authorize: (session) => authorityOf(canEdit(session, ownPreparationTarget(input.scope, session))),
    readCurrent: (documents, payload) => partnerCurrentTarget(documents, payload.partnerId),
    apply: (context, payload, scope) => applyPreparationArchive(context, payload, scope, archived),
  });
}
/** Archives one private preparation record: it leaves the working lists and nothing is deleted. */
export const archivePreparation = async (input: MutationInput<ArchivePreparationInput>, source?: SessionSource): Promise<MutationOutcome> => runPreparationArchive(input, source, "archivePreparation", archivePreparationInput, true);
/** Restores one archived private preparation record to the working lists. */
export const restorePreparation = async (input: MutationInput<RestorePreparationInput>, source?: SessionSource): Promise<MutationOutcome> => runPreparationArchive(input, source, "restorePreparation", restorePreparationInput, false);
/** Writes one private note about one partner record. */ export async function savePrivateNote(input: MutationInput<SavePrivateNoteInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<SavePrivateNoteInput, NoteChangeResult>(input, source, { name: "savePrivateNote", schema: savePrivateNoteInput, authorize: (session) => authorityOf(canEdit(session, ownPrivateNoteTarget(input.scope, session))), apply: applySavePrivateNote });
}
function applySavePrivateNote({ docs, session, operationId }: MutationContext, payload: SavePrivateNoteInput, scope: Scope): ApplyResult<NoteChangeResult> {
  const state = stateDocumentOf(docs);
  const record = partnerOf(state, payload.partnerId);
  if (record === undefined || !canView(session, partnerTarget(scope, record, state.context.principalId)).allowed) return refuseDenied(operationId);
  if (state.privateNotes.some((note) => note.partnerId === record.partnerId && note.authorPrincipalId === session.principalId && note.body === payload.body)) return NOTHING_TO_CHANGE;
  const note: PrivateNoteRecord = { noteId: newRecordId(), partnerId: record.partnerId, authorPrincipalId: session.principalId, body: payload.body, audience: "private", createdAt: recordedAt(), revision: nextRevision() };
  writeState(docs, state, { privateNotes: [...state.privateNotes, note] });
  return { changed: true, revision: note.revision, result: { partnerId: note.partnerId, noteId: note.noteId, revision: note.revision }, created: [note.noteId] };
}
/** Records one interaction that actually happened with a partner. */ export async function logInteraction(input: MutationInput<LogInteractionInput>, source?: SessionSource): Promise<MutationOutcome> {
  return runPartnerMutation<LogInteractionInput, InteractionChangeResult>(input, source, { name: "logInteraction", schema: logInteractionInput, authorize: (session) => authorityOf(canEdit(session, interactionTarget(input.scope))), apply: applyLogInteraction });
}
function applyLogInteraction({ docs, session, operationId }: MutationContext, payload: LogInteractionInput, scope: Scope): ApplyResult<InteractionChangeResult> {
  const state = stateDocumentOf(docs);
  const record = partnerOf(state, payload.partnerId);
  if (record === undefined || !canView(session, partnerTarget(scope, record, state.context.principalId)).allowed) return refuseDenied(operationId);
  const provenance: SourceReference | null = payload.provenance ?? null;
  if (provenance !== null && state.interactions.some((interaction) => interaction.provenance !== null && sameSourceReference(interaction.provenance, provenance))) return NOTHING_TO_CHANGE;
  const participants: readonly InteractionParticipant[] = payload.participants.map((participant) => ({ role: participant.role, partnerId: partnerOf(state, participant.partnerId)?.partnerId ?? null, principalId: null }));
  if (participants.some((participant) => participant.partnerId === null)) return NOTHING_TO_CHANGE;
  const note: InteractionNote | null = payload.note === undefined ? null : { body: payload.note, audience: "private", authorPrincipalId: session.principalId };
  const occurredOn = payload.occurredOn.precision === "unknown" ? null : (payload.occurredOn.date ?? null);
  const interaction: InteractionRecord = { interactionId: newRecordId(), partnerId: record.partnerId, type: payload.type, occurredOn, precision: payload.occurredOn.precision, outcome: payload.outcome, participants, note, provenance, revision: nextRevision() };
  writeState(docs, state, { interactions: [...state.interactions, interaction] });
  return { changed: true, revision: interaction.revision, result: { partnerId: interaction.partnerId, interactionId: interaction.interactionId, revision: interaction.revision }, created: [interaction.interactionId] };
}
