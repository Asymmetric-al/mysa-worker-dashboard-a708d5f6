"use client";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { ZodError, ZodType } from "zod";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { ReadTransportError, fetchRead, sendMutation, useAttemptIdentity } from "@/lib/read-transport";
import { assertNever } from "@/lib/result";
import type { MutationInput, ReadEnvelope, Scope } from "@/modules/data-service/envelope";
import type { FieldMessages, MutationOutcome, ReadResult } from "@/modules/data-service/outcome";
import { logInteractionPayloadSchema, type LogInteractionPayload } from "../schemas/interaction";
import { saveContactEditsPayloadSchema, type SaveContactEditsPayload } from "../schemas/partner-edit";
import { archivePreparationPayloadSchema, createPrivatePreparationPayloadSchema, restorePreparationPayloadSchema, type ArchivePreparationPayload, type CreatePrivatePreparationPayload, type RestorePreparationPayload } from "../schemas/preparation";
import { savePrivateNotePayloadSchema, type SavePrivateNotePayload } from "../schemas/private-note";
import { deleteViewPayloadSchema, renameViewPayloadSchema, saveViewPayloadSchema, type DeleteViewPayload, type RenameViewPayload, type SaveViewPayload } from "../schemas/saved-view";
import { setFavouritePayloadSchema, setTagPayloadSchema, type SetFavouritePayload, type SetTagPayload } from "../schemas/tag";
export const PARTNER_KEY = { roster: "partners", facets: "facets", savedViews: "saved-views", record: "partner", preparation: "preparation", interactions: "interactions" } as const;
export type PartnerKeySegment = (typeof PARTNER_KEY)[keyof typeof PARTNER_KEY];
export const PARTNER_MUTATION_NAMES = ["createPrivatePreparation", "saveContactEdits", "savePrivateNote", "logInteraction", "archivePreparation", "restorePreparation", "saveView", "renameView", "deleteView", "setTag", "setFavourite"] as const;
export type PartnerMutationName = (typeof PARTNER_MUTATION_NAMES)[number];
/** The `[partnerId]` segment the saved-view route carries and does not use: a saved view belongs to the caller, not to a partner, so the handler awaits and discards the segment, and this value places the request while identifying no record. */
const SAVED_VIEW_ROUTE_PLACEHOLDER = "no-partner";
export const PARTNER_POST_PATHS = {
  create: (): string => "/api/partners",
  edits: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/edits`,
  notes: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/notes`,
  interactions: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/interactions`,
  views: (): string => `/api/partners/${SAVED_VIEW_ROUTE_PLACEHOLDER}/views`,
  archive: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/archive`,
  tags: (partnerId: string): string => `/api/partners/${encodeURIComponent(partnerId)}/tags`,
} as const;
export { ReadTransportError as PartnerReadTransportError };
/** Reads one of the family's read URLs and answers the four-way result the contract states: the scoped envelope, a denial, the refusal of a request the read does not admit, or an unavailable source. */
export const fetchPartnerRead = async <T>(url: string): Promise<ReadResult<ReadEnvelope<T>>> => fetchRead<T>({ url, admits: isRecord });
type ExpectedRevision = MutationInput<unknown>["expectedRevision"];
export type PartnerMutationInput<TPayload> = { readonly scope: Scope; readonly expectedRevision: ExpectedRevision; readonly payload: TPayload };
export interface PartnerMutationHandle<TPayload> {
  readonly submit: (input: PartnerMutationInput<TPayload>) => Promise<MutationOutcome>;
  readonly reset: () => void;
  readonly isPending: boolean;
  readonly outcome: MutationOutcome | null;
  readonly submitted: { readonly expectedRevision: ExpectedRevision; readonly payload: TPayload } | null;
  readonly operationId: string | null;
}
type WireFields = Record<string, unknown>;
type PartnerMutationConfig<TPayload> = { readonly name: PartnerMutationName; readonly schema: ZodType<TPayload>; readonly routeDiscriminant?: { readonly field: "intent" | "operation" }; readonly wire?: (payload: TPayload) => WireFields };
type PartnerSettlement<TPayload> = { readonly operationId: string; readonly outcome: MutationOutcome; readonly input: PartnerMutationInput<TPayload> };
type PartnerAttempt<TPayload> = { readonly operationId: string; readonly input: PartnerMutationInput<TPayload> };
const OFFLINE_GUIDANCE = "This device reported no connection, so the request did not leave from here. Reconnect and submit this same change again: it keeps this attempt's identity, so a request that had already arrived is answered with its original result rather than applied twice.";
const PRESERVING_OUTCOMES: ReadonlySet<MutationOutcome["outcome"]> = new Set<MutationOutcome["outcome"]>(["conflict", "invalid", "unavailable"]);
function fieldsOf(error: ZodError): FieldMessages {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "_root" : issue.path.map((segment) => String(segment)).join(".");
    const messages = fields[path];
    if (messages === undefined) fields[path] = [issue.message];
    else if (!messages.includes(issue.message)) messages.push(issue.message);
  }
  return fields;
}
const invalidOutcome = (operationId: string, error: ZodError): MutationOutcome => ({ outcome: "invalid", operationId, fields: fieldsOf(error) });
const structuredFields = (payload: object): WireFields => Object.fromEntries(Object.entries(payload));
function wireFieldsOf<TPayload extends object>(config: PartnerMutationConfig<TPayload>, payload: TPayload): WireFields {
  const stated: WireFields = config.wire === undefined ? structuredFields(payload) : config.wire(payload);
  return config.routeDiscriminant === undefined ? stated : { ...stated, [config.routeDiscriminant.field]: config.name };
}
function refreshedReads(name: PartnerMutationName): readonly { readonly segment: PartnerKeySegment; readonly addressedRecord?: true }[] {
  switch (name) {
    case "createPrivatePreparation":
      return [{ segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }, { segment: PARTNER_KEY.preparation }];
    case "saveContactEdits":
      return [{ segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }];
    case "savePrivateNote":
      return [{ segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.preparation }];
    case "logInteraction":
      return [{ segment: PARTNER_KEY.interactions }, { segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.roster }];
    case "archivePreparation":
    case "restorePreparation":
      return [{ segment: PARTNER_KEY.preparation }, { segment: PARTNER_KEY.record, addressedRecord: true }, { segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }];
    case "saveView":
    case "renameView":
    case "deleteView":
      return [{ segment: PARTNER_KEY.savedViews }];
    case "setTag":
    case "setFavourite":
      return [{ segment: PARTNER_KEY.roster }, { segment: PARTNER_KEY.facets }, { segment: PARTNER_KEY.record, addressedRecord: true }];
    default:
      return assertNever(name, "Unhandled partner mutation");
  }
}
const standsAsChanged = (outcome: MutationOutcome): boolean => outcome.outcome === "accepted" || outcome.outcome === "alreadyAccepted";
async function refreshPartnerReads(queryClient: QueryClient, outcome: MutationOutcome, scope: Scope, name: PartnerMutationName, partnerId: string | undefined): Promise<void> {
  if (!standsAsChanged(outcome)) return;
  const prefix = scopeKey(scope);
  const keys = refreshedReads(name).map((refresh) => {
    const addressed = refresh.addressedRecord === true && partnerId !== undefined ? [partnerId] : [];
    return { queryKey: [...prefix, refresh.segment, ...addressed] };
  });
  await Promise.all(keys.map((key) => queryClient.invalidateQueries(key)));
}
function submittedOf<TPayload>(settlement: PartnerSettlement<TPayload> | null): PartnerMutationHandle<TPayload>["submitted"] {
  return settlement === null || !PRESERVING_OUTCOMES.has(settlement.outcome.outcome) ? null : { expectedRevision: settlement.input.expectedRevision, payload: settlement.input.payload };
}
function usePartnerMutation<TPayload extends object>(config: PartnerMutationConfig<TPayload>, url: string, partnerId?: string): PartnerMutationHandle<TPayload> {
  const queryClient = useQueryClient();
  const [settlement, setSettlement] = useState<PartnerSettlement<TPayload> | null>(null);
  const { operationIdFor, forget } = useAttemptIdentity();
  const inFlightRef = useRef<Promise<MutationOutcome> | null>(null);
  const mutation = useMutation<MutationOutcome, never, PartnerAttempt<TPayload>>({
    mutationFn: async (attempt: PartnerAttempt<TPayload>): Promise<MutationOutcome> => {
      const parsed = config.schema.safeParse(attempt.input.payload);
      const outcome = parsed.success ? await sendMutation(url, { operationId: attempt.operationId, scope: attempt.input.scope, expectedRevision: attempt.input.expectedRevision, payload: wireFieldsOf(config, parsed.data) }, OFFLINE_GUIDANCE) : invalidOutcome(attempt.operationId, parsed.error);
      try {
        await refreshPartnerReads(queryClient, outcome, attempt.input.scope, config.name, partnerId);
      } catch {}
      return outcome;
    },
    retry: false,
  });
  const { mutateAsync } = mutation;
  const submit = useCallback(
    (input: PartnerMutationInput<TPayload>): Promise<MutationOutcome> => {
      const running = inFlightRef.current;
      if (running !== null) return running;
      const operationId = operationIdFor(config.name, input.scope, input.expectedRevision, input.payload);
      const settled = mutateAsync({ operationId, input }).then((outcome: MutationOutcome): MutationOutcome => {
        setSettlement({ operationId, outcome, input });
        return outcome;
      });
      const pending: Promise<MutationOutcome> = settled.finally(() => {
        if (inFlightRef.current === pending) inFlightRef.current = null;
      });
      inFlightRef.current = pending;
      return pending;
    },
    [mutateAsync, operationIdFor, config.name],
  );
  const reset = useCallback((): void => {
    forget();
    setSettlement(null);
  }, [forget]);
  return { submit, reset, isPending: mutation.isPending, outcome: settlement === null ? null : settlement.outcome, submitted: submittedOf(settlement), operationId: settlement === null ? null : settlement.operationId };
}
const CREATE_PRIVATE_PREPARATION: PartnerMutationConfig<CreatePrivatePreparationPayload> = { name: "createPrivatePreparation", schema: createPrivatePreparationPayloadSchema };
const SAVE_CONTACT_EDITS: PartnerMutationConfig<SaveContactEditsPayload> = { name: "saveContactEdits", schema: saveContactEditsPayloadSchema };
const SAVE_PRIVATE_NOTE: PartnerMutationConfig<SavePrivateNotePayload> = { name: "savePrivateNote", schema: savePrivateNotePayloadSchema, wire: (payload) => ({ body: payload.body }) };
const LOG_INTERACTION: PartnerMutationConfig<LogInteractionPayload> = { name: "logInteraction", schema: logInteractionPayloadSchema };
const ARCHIVE_PREPARATION: PartnerMutationConfig<ArchivePreparationPayload> = { name: "archivePreparation", schema: archivePreparationPayloadSchema, routeDiscriminant: { field: "intent" } };
const RESTORE_PREPARATION: PartnerMutationConfig<RestorePreparationPayload> = { name: "restorePreparation", schema: restorePreparationPayloadSchema, routeDiscriminant: { field: "intent" } };
const SAVE_VIEW: PartnerMutationConfig<SaveViewPayload> = { name: "saveView", schema: saveViewPayloadSchema, routeDiscriminant: { field: "intent" } };
const RENAME_VIEW: PartnerMutationConfig<RenameViewPayload> = { name: "renameView", schema: renameViewPayloadSchema, routeDiscriminant: { field: "intent" } };
const DELETE_VIEW: PartnerMutationConfig<DeleteViewPayload> = { name: "deleteView", schema: deleteViewPayloadSchema, routeDiscriminant: { field: "intent" } };
const SET_TAG: PartnerMutationConfig<SetTagPayload> = { name: "setTag", schema: setTagPayloadSchema, routeDiscriminant: { field: "operation" } };
const SET_FAVOURITE: PartnerMutationConfig<SetFavouritePayload> = { name: "setFavourite", schema: setFavouritePayloadSchema, routeDiscriminant: { field: "operation" } };
/** Drives `createPrivatePreparation` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useCreatePrivatePreparation = (): PartnerMutationHandle<CreatePrivatePreparationPayload> => usePartnerMutation(CREATE_PRIVATE_PREPARATION, PARTNER_POST_PATHS.create());
/** Drives `saveContactEdits` for the record named by `partnerId` and answers one of the eight mutation outcomes. */
export const useSaveContactEdits = (partnerId: string): PartnerMutationHandle<SaveContactEditsPayload> => usePartnerMutation(SAVE_CONTACT_EDITS, PARTNER_POST_PATHS.edits(partnerId), partnerId);
/** Drives `savePrivateNote` for the record named by `partnerId` and answers one of the eight mutation outcomes. */
export const useSavePrivateNote = (partnerId: string): PartnerMutationHandle<SavePrivateNotePayload> => usePartnerMutation(SAVE_PRIVATE_NOTE, PARTNER_POST_PATHS.notes(partnerId), partnerId);
/** Drives `logInteraction` for the record named by `partnerId` and answers one of the eight mutation outcomes. */
export const useLogInteraction = (partnerId: string): PartnerMutationHandle<LogInteractionPayload> => usePartnerMutation(LOG_INTERACTION, PARTNER_POST_PATHS.interactions(partnerId), partnerId);
/** Drives `archivePreparation` for the preparation named by `partnerId` and answers one of the eight mutation outcomes. */
export const useArchivePreparation = (partnerId: string): PartnerMutationHandle<ArchivePreparationPayload> => usePartnerMutation(ARCHIVE_PREPARATION, PARTNER_POST_PATHS.archive(partnerId), partnerId);
/** Drives `restorePreparation` for the preparation named by `partnerId` and answers one of the eight mutation outcomes. */
export const useRestorePreparation = (partnerId: string): PartnerMutationHandle<RestorePreparationPayload> => usePartnerMutation(RESTORE_PREPARATION, PARTNER_POST_PATHS.archive(partnerId), partnerId);
/** Drives `saveView` for the caller's own roster query and answers one of the eight mutation outcomes; the path places a caller-level change, so it names no partner. */
export const useSaveView = (): PartnerMutationHandle<SaveViewPayload> => usePartnerMutation(SAVE_VIEW, PARTNER_POST_PATHS.views());
/** Drives `renameView` on one of the caller's saved views and answers one of the eight mutation outcomes; the path places a caller-level change, so it names no partner. */
export const useRenameView = (): PartnerMutationHandle<RenameViewPayload> => usePartnerMutation(RENAME_VIEW, PARTNER_POST_PATHS.views());
/** Drives `deleteView` on one of the caller's saved views and answers one of the eight mutation outcomes; the path places a caller-level change, so it names no partner. */
export const useDeleteView = (): PartnerMutationHandle<DeleteViewPayload> => usePartnerMutation(DELETE_VIEW, PARTNER_POST_PATHS.views());
/** Drives `setTag` on the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useSetTag = (partnerId: string): PartnerMutationHandle<SetTagPayload> => usePartnerMutation(SET_TAG, PARTNER_POST_PATHS.tags(partnerId), partnerId);
/** Drives `setFavourite` on the record named by `partnerId` and answers one of the eight outcomes: `accepted`, `alreadyAccepted`, `unchanged`, `conflict`, `denied`, `invalid`, `unavailable` or `unknown`. */
export const useSetFavourite = (partnerId: string): PartnerMutationHandle<SetFavouritePayload> => usePartnerMutation(SET_FAVOURITE, PARTNER_POST_PATHS.tags(partnerId), partnerId);
