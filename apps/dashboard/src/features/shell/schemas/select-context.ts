/**
 * The Shell family's `selectContext` request contract: the context a session asks to act in, and the
 * four-field mutation input that carries that request to `POST /api/session/context`.
 *
 * Plan items: AAP 0.6.3's `POST /api/session/context` row — the mutation that selects the
 * organisation, ministry and support subject, whose outcome is `conflict` when unsaved work must be
 * resolved first, and whose target must be an admitted membership — AAP 0.7.1's four-field input and
 * closed eight-outcome set, and AAP 0.11.1's `features/shell/**` row. The folder holds this file and
 * the development control payload beside it, and nothing else.
 *
 * Shape only, never authority. The three identifiers are opaque references to three different owners,
 * and they establish neither identity nor an admitted membership, so nothing here decides whether the
 * caller may switch or what it may see: `mutations/dev.ts#selectContext` re-derives the session,
 * admits the target as one membership and answers `denied` when it does not, and a payload accepted
 * here is never an accepted switch.
 *
 * The payload mirrors that mutation's own schema member for member — the same branded identifier
 * schemas in the same order, plus the caller's optional decision about work it has not yet saved — so
 * a request this file accepts is one the service accepts, and `SelectContextRequest` is assignable to
 * `MutationInput<SelectContextPayload>` with no cast. The envelope itself is declared once, in
 * `@/modules/data-service/envelope`, and is composed here through `mutationInputSchema` rather than
 * re-listed: a second declaration of `operationId`, `scope` or `expectedRevision` is exactly the
 * duplicate ownership that would let the request and its contract drift apart.
 *
 * That module is imported directly rather than through the service barrel, because the barrel
 * re-exports every read and mutation and so reaches `node:fs`, and a shell schema that a client
 * surface imports must not pull the synthetic store into a browser bundle.
 *
 * Rule 1 clause 1: no tenant, membership, identity or provider field appears here, and no capability
 * the release defers. Clause 2: the specified patterns — one envelope, one payload per mutation and
 * the branded scope identifiers — are reused, with no wrapper, second validator or generic field map.
 * Clause 3: the schema validates shape only and keeps the identifiers opaque, so consent, financial,
 * publication and communication outcomes stay outside anything it can decide.
 */
import { z } from "zod";

import {
  ministryIdSchema,
  mutationInputSchema,
  organizationIdSchema,
  supportSubjectIdSchema,
} from "@/modules/data-service/envelope";
import type { UnsavedWorkResolution } from "@/modules/data-service/mutations/dev";

/**
 * Validates the caller's own decision about work it has not saved: keep it, discard it, or stay here.
 *
 * The three values are the service's closed set (`UNSAVED_WORK_RESOLUTIONS` in `mutations/dev.ts`),
 * restated as a literal only because importing that value would reach a server-only module; the
 * annotation against its exported type makes a change to the set a compile error here rather than a
 * silent drift. An absent decision is the ordinary switch, so the member is optional.
 */
const unsavedWorkResolutionSchema: z.ZodType<UnsavedWorkResolution> = z.enum([
  "save",
  "discard",
  "stay",
]);

/** Validates the `selectContext` payload: the target context only, plus the caller's optional decision. */
export const selectContextPayloadSchema = z.strictObject({
  organizationId: organizationIdSchema,
  ministryId: ministryIdSchema,
  supportSubjectId: supportSubjectIdSchema,
  resolveUnsavedWork: unsavedWorkResolutionSchema.optional(),
});

/** The validated `selectContext` payload: three opaque context references and an optional resolution. */
export type SelectContextPayload = z.infer<typeof selectContextPayloadSchema>;

/** Validates selectContext — accepted | alreadyAccepted | unchanged | conflict | denied | invalid | unavailable | unknown. */
export const selectContextRequestSchema = mutationInputSchema(selectContextPayloadSchema);

/** The validated `selectContext` request: the four-field mutation input over the payload above. */
export type SelectContextRequest = z.infer<typeof selectContextRequestSchema>;
