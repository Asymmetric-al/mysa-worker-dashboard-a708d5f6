/**
 * The Worker and Project Pages family's two reach payloads — `setReach` and `stopShowingPublicly` —
 * each with the four-field mutation envelope it is posted inside.
 *
 * Plan items that put this file in scope:
 * - AAP 0.9.1's tree row for this family's folder and 0.11.1's deliverable row for it.
 * - AAP 0.6.1 "Mutations: content and media": `setReach` and `stopShowingPublicly`.
 * - AAP 0.6.3 on `/reach`, the one Pages route that carries these two mutations.
 * - AAP 0.8.6 and criterion 12: reach is exactly three values — `not-public`, `link-public` and
 *   `listed` — and no custom visibility; *Stop showing me publicly* contains every locale edition of
 *   one page immediately, works while an unrelated draft of that page is invalid, and never claims to
 *   recall a copy already received.
 * - Rule 1 clause 1: these two payloads, and nothing a deferred capability would want.
 *
 * Both payloads name one Page, because that is the unit the service changes. `setReach` states the
 * page and the reach it takes, and the service applies that reach to every released edition the page
 * holds — AAP 0.6.2 carries `reach` on the *Release* record, and the mutation that writes it walks
 * the page's release heads — so a locale edition is never addressed on its own here and the released
 * editions of one page reach as a set. *Stop showing me publicly* names the same unit for the other
 * reason: it contains every edition of the page at one instant, in every locale and audience,
 * including an edition whose sibling draft still needs fixing.
 *
 * The containment acknowledgement is a browser-side requirement and never a wire field. The worker
 * must be told, and must confirm, that stopping public display hides every language edition; but the
 * service's payload for that mutation is the page identity alone and its object is strict, so an
 * acknowledgement key posted beside it would come back `invalid`. `stopShowingPubliclyFormSchema`
 * below therefore holds the confirmation the dialog collects and `.transform`s it away into the wire
 * payload, following `goalSaveFormSchema` -> `goalSavePayloadSchema` in `features/support/schemas.ts`.
 * The confirmation is recorded where it is given and cannot be defaulted or coerced into an
 * instruction nobody gave, because the form field is `z.literal(true)`.
 *
 * The service owns both wire shapes, so the schemas below carry its own payload types as annotations
 * and every import of those types is type-only: `import type` is erased at compile time, so this
 * browser-loaded file still reaches no server module — no store, no `node:fs`, no mutation body — and
 * a field that drifts from the wire contract fails the typecheck instead of coming back `invalid`.
 *
 * The three reach values are not listed in this file. `REACH_VALUES` in `@/modules/content/reach` is
 * their one declaration (derived in turn from the release record's own tuple), so the enum below is
 * built from that import and follows it without an edit here: a fourth value is accepted by this
 * schema the moment it is declared there, and the surfaces that must word it — the status badge and
 * the family copy — fail to compile until they word it.
 *
 * Shape only, never admissibility. Whether the caller may change this page, whether the page holds a
 * released edition at all, which release records the change and the instant a withdrawal is recorded
 * at are the service's questions, answered when the mutation runs; a payload accepted here is not an
 * accepted change. Reach is neither publication nor notification either: neither object carries a
 * publish, notify, send, schedule or recall field, because choosing how far a released edition
 * reaches sends nothing and so cannot bring back a message already submitted or a copy a third party
 * already holds.
 *
 * The envelope is composed, not hand-written. Every mutation presents
 * `{ operationId, scope, expectedRevision, payload }`, and `mutationInputSchema` builds that request
 * shape around each payload below, so neither payload declares a revision, an operation identity or
 * a scope, and no caller can assemble the envelope with a field missing.
 *
 * Layering: plain TypeScript — no JSX, no React import, no hook, no component and no style value —
 * because the browser's reach control validates with these schemas. Nothing server-only may reach
 * this file. No limit is invented here: a count of editions or a date bound belongs to the service.
 * No display wording appears here either, since the fixed names of the three values are owned by
 * `@/components/status-badge.tsx` and `../copy.ts`; this file carries the field messages a rejected
 * payload shows and nothing else.
 *
 * Rule 1 clause 2: the vocabulary is imported rather than restated and the envelope is reused rather
 * than rewritten; there are no wrappers, no dispatcher and no `index.ts` beside this file.
 */
import { z } from "zod";

// The envelope comes from its own module rather than the `@/modules/data-service` barrel: the barrel
// also re-exports the reads and mutations, whose graph reaches the store and `node:fs`, while this
// file is loaded by the browser's reach control.
import { mutationInputSchema } from "@/modules/data-service/envelope";
// The annotation types are imported with `import type`, which the compiler erases: they hold these
// schemas to the service's own payload types without pulling the mutation bodies, the store or
// `node:fs` into a client bundle.
import type {
  DocumentPayload,
  SetReachPayload as ServiceSetReachPayload,
} from "@/modules/data-service/mutations/content";
import { REACH_VALUES } from "@/modules/content/reach";

// ---------------------------------------------------------------------------------------------
// Every refusal these payloads can show
// ---------------------------------------------------------------------------------------------

/**
 * The messages a rejected payload shows, stated once so the wrong-type and the empty case of one
 * field cannot drift apart and no schema below writes a message literal inline.
 *
 * Each sentence names the fix in the worker's own terms, says nothing about a record the caller may
 * not see (a refusal of access is the service's `denied` outcome, never a field message), and
 * repeats none of the three visibility names: what each value means is copy the reach control shows
 * beside its options, and a refusal here only says that a choice is missing or is not one of the
 * three.
 */
const MESSAGES = {
  /** No page was named for a reach change. */
  reachDocumentRequired: "Open the page whose reach you want to change.",
  /** The submitted value was not one of the three reach settings. */
  reachInvalid: "Choose one of the three visibility options.",
  /** No page was named for a containment. */
  documentRequired: "Open the page you want to stop showing publicly.",
  /** The containment acknowledgement was absent, false, or given as text or a number. */
  containmentUnacknowledged: "Confirm that this hides every language edition of this page.",
} as const;

// ---------------------------------------------------------------------------------------------
// setReach: how far one page's released editions reach
// ---------------------------------------------------------------------------------------------

/**
 * Validates the `setReach` payload: the page whose released editions change reach, and the reach they
 * take.
 *
 * The service writes that value onto every release head the page holds, so the payload names the page
 * once and states one reach for it. There is no edition key here: a payload naming an edition would
 * describe a narrower change than the mutation makes, and the service's own strict object would
 * refuse the extra key. Annotating the schema with the service's `SetReachPayload` is what keeps that
 * shape honest — a member this file drops or mistypes fails the typecheck.
 *
 * The object is strict for the same reason: an attempt to smuggle in an edition, a locale, a
 * publication instant, a release identity or a flag such as `indexable` is refused rather than
 * quietly dropped, so reach stays one value of the closed vocabulary with nothing travelling beside
 * it.
 */
export const setReachPayloadSchema: z.ZodType<ServiceSetReachPayload> = z.strictObject({
  documentId: z
    .string({ message: MESSAGES.reachDocumentRequired })
    .trim()
    .min(1, { message: MESSAGES.reachDocumentRequired }),
  // The three values come from `reach.ts`, and no component may invent a fourth: a value outside the
  // vocabulary is refused here rather than snapped to whichever member looks closest.
  reach: z.enum(REACH_VALUES, { message: MESSAGES.reachInvalid }),
});

/** The validated `setReach` payload: the page whose released editions change reach, and that reach. */
export type SetReachPayload = z.infer<typeof setReachPayloadSchema>;

/** Feeds `setReach`: that payload inside the shared operation, scope and revision envelope. */
export const setReachInputSchema = mutationInputSchema(setReachPayloadSchema);

/** The complete `setReach` request body, inferred so the reach control and its hook hold one shape. */
export type SetReachInput = z.infer<typeof setReachInputSchema>;

// ---------------------------------------------------------------------------------------------
// stopShowingPublicly: every edition of one page, at once
// ---------------------------------------------------------------------------------------------

/** One page's identity, as the wire payload and the dialog that produces it both state it. */
const documentIdField = z
  .string({ message: MESSAGES.documentRequired })
  .trim()
  .min(1, { message: MESSAGES.documentRequired });

/**
 * Validates the `stopShowingPublicly` payload the service accepts: the page, and nothing beside it.
 *
 * The document is the unit because containment covers every locale edition of one page at one
 * instant, including an edition that is listed and one whose sibling draft still needs fixing. The
 * object is strict for that reason: a `variantId`, `locale`, `variantIds`, `reason` or
 * acknowledgement key would put a partial containment into a payload that has no way to mean one, and
 * the service's own strict object would refuse it, so such a request is refused outright instead of
 * being narrowed by guesswork. Nothing here says anything about a copy already received — withdrawal
 * stops this application serving the page and recalls nothing.
 */
export const stopShowingPubliclyPayloadSchema: z.ZodType<DocumentPayload> = z.strictObject({
  documentId: documentIdField,
});

/**
 * Validates what the containment dialog submits: the page, and the worker's explicit confirmation
 * that every language edition of it stops being served.
 *
 * The confirmation is a requirement of the surface and not of the wire, which is why it lives here
 * and is dropped by the transform: the service's payload carries the page identity alone, so posting
 * the acknowledgement beside it would make every containment `invalid`. Keeping the two in one schema
 * is what makes the confirmation impossible to skip — the transform cannot produce the payload
 * without it — while the payload it produces is exactly the shape the service reads, stated as
 * `DocumentPayload` so the two cannot drift apart.
 *
 * `z.literal(true)` rather than `z.boolean()`: `false`, `"true"`, `1` and an omitted value each fail at
 * this field, and nothing here defaults the acknowledgement to `true`, because a defaulted or coerced
 * confirmation would fabricate an instruction nobody gave.
 */
export const stopShowingPubliclyFormSchema = z
  .strictObject({
    documentId: documentIdField,
    acknowledgeContainsAllLocales: z.literal(true, {
      message: MESSAGES.containmentUnacknowledged,
    }),
  })
  .transform((form): DocumentPayload => ({ documentId: form.documentId }));

/** The validated `stopShowingPublicly` payload: the page whose editions are contained. */
export type StopShowingPubliclyPayload = z.infer<typeof stopShowingPubliclyPayloadSchema>;

/** Feeds `stopShowingPublicly`: that payload inside the shared operation, scope and revision envelope. */
export const stopShowingPubliclyInputSchema = mutationInputSchema(stopShowingPubliclyPayloadSchema);

/** The complete `stopShowingPublicly` request body, inferred so its dialog and hook hold one shape. */
export type StopShowingPubliclyInput = z.infer<typeof stopShowingPubliclyInputSchema>;
