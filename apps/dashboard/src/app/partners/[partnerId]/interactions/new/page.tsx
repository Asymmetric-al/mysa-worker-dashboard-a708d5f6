/** `/partners/[partnerId]/interactions/new` — log something that actually happened about one record, with an optional follow-up task composed as a second and separate change.
 *
 * What this file is. Route composition and nothing else. It resolves admission through the one partner read, decides which of the four answers that read can give to render, and hands the record it read to the Partners family's single interaction form. The form owns both operations and both attempt identities, the civil date and the precision it is known to, participant selection by opaque reference, every per-field message and every one of the eight outcomes — so this route mints no identifier, states no payload and renders no submit control of its own.
 *
 * What it never does. It posts nothing, requests nothing from this application's own handlers, and states nothing else the envelope carries: no support figure, no note body, no total and no deadline. A refusal is answered with its reason code alone, because authorisation precedes enumeration and a denied read discloses no count, title, size or existence.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import InteractionForm from "@/features/partners/components/interaction-form";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import { reads, type ReadAction } from "@/modules/data-service";

// ---------------------------------------------------------------------------------------------
// Fixed values
// ---------------------------------------------------------------------------------------------

/** The partner surface's own path. The roster a refusal offers and the record this form belongs to are both addressed from it, and neither is derived from a name, an address or an email. */
const PARTNERS_PATH = "/partners";

/** This form's segment below one record, so a failed read re-requests the form it was opened for rather than dropping the record. */
const FORM_SUFFIX = "/interactions/new";

/** The one advisory action this route reflects. The read advertising `logInteraction` is what makes the form appear; the service re-checks the permission on submit, so a stale envelope can only produce a `denied` outcome and never an unauthorised write. */
const LOG_INTERACTION_ACTION = "logInteraction";

/** This surface's state wording, taken from the family's own copy rather than restated here. */
const SURFACE_COPY = SURFACE_STATE_COPY.interactions;

/** A refusal of the record identifier is the partner read's, so it is stated in the wording that read owns rather than in a list's wording about parameters this route never sends. */
const RECORD_REFUSED_COPY = SURFACE_STATE_COPY["partner-detail"].refused;

const HEADING_LEAD = "Log an interaction with";

const HEADING_BODY = "What you record here is a contact that actually happened, with the day it happened or the precision you honestly have. A follow-up task is optional and is saved as a separate change with its own identity, so a task that fails never sends the interaction again.";

const RETURN_LABEL = "Back to the record";

const PAGE_CLASS = "flex min-w-0 flex-col gap-6 text-start";

const NOTICE_CLASS = "flex min-w-0 flex-col gap-4 text-start";

const TITLE_CLASS = "text-2xl font-semibold text-pretty wrap-anywhere";

const HEADING_BLOCK_CLASS = "flex min-w-0 flex-col gap-2";

const RETURN_LINK_CLASS = "inline-flex min-h-6 items-center rounded-sm font-medium underline underline-offset-4";

// ---------------------------------------------------------------------------------------------
// Addresses and the advisory action
// ---------------------------------------------------------------------------------------------

/** The address of one record, from its opaque identifier alone. */
function recordHref(partnerId: string): string {
  return `${PARTNERS_PATH}/${encodeURIComponent(partnerId)}`;
}

/** The address of this form for one record, which is what a failed read asks for again. */
function formHref(partnerId: string): string {
  return `${recordHref(partnerId)}${FORM_SUFFIX}`;
}

/** Whether the read advertises one action. Reflecting the envelope's advisory list is not a permission decision: it decides what this page offers, never what the service allows. */
function advertised(actions: readonly ReadAction[], name: string): boolean {
  return actions.some((action) => action.name === name && action.available);
}

// ---------------------------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------------------------

/** Props of {@link NewInteractionPage}: Next 16 hands the segment over as a promise, awaited before the read. */
export interface NewInteractionPageProps {
  readonly params: Promise<{ partnerId: string }>;
}

/** One record belongs to one session's context and one scenario instant, so no rendered page may be cached across a context switch, a restriction or a persona change. */
export const dynamic = "force-dynamic";

/** Everything that actually happened between the worker and one record: the entry itself, with the optional next task saved as a second change. */
export default async function NewInteractionPage({ params }: NewInteractionPageProps): Promise<ReactElement> {
  const { partnerId } = await params;
  // The organisation, ministry, support subject and principal are derived by the service from this session. The route supplies the record's opaque identifier and nothing that could invent authority.
  const result = await reads.partners.readPartner(partnerId);
  if (result.kind === "denied") {
    return (
      <div className={NOTICE_CLASS}>
        {/* A refusal shows no part of a record. The shell owns the context switch, so the recovery this route can offer is the roster the reader came from. */}
        <StateNotice kind="denied" headingLevel={1} title={SURFACE_COPY.denied.title} description={SURFACE_COPY.denied.body} reasonCode={result.denied.reasonCode} action={{ label: PARTNER_ACTION_LABELS.backToRoster, href: PARTNERS_PATH }} />
      </div>
    );
  }
  if (result.kind === "unavailable") {
    return (
      <div className={NOTICE_CLASS}>
        {/* The source did not answer, so this is reported as unavailable and never as an empty form: a failed read is not a record with nothing to say. Asking again re-requests this same form. */}
        <StateNotice kind="unavailable" headingLevel={1} title={SURFACE_COPY.unavailable.title} description={SURFACE_COPY.unavailable.body} source={result.unavailable.source} action={{ label: PARTNER_ACTION_LABELS.retry, href: formHref(partnerId) }} />
      </div>
    );
  }
  if (result.kind === "refused") {
    // The identifier this form was opened with is not one the partner read admits, so nothing was read and the partner source did not fail. The refusal is stated here rather than thrown.
    return (
      <div className={NOTICE_CLASS}>
        <StateNotice kind="refused" headingLevel={1} title={RECORD_REFUSED_COPY.title} description={RECORD_REFUSED_COPY.body} action={{ label: PARTNER_ACTION_LABELS.backToRoster, href: PARTNERS_PATH }} />
      </div>
    );
  }
  const { envelope } = result;
  const { partner } = envelope.data;
  const record = recordHref(partner.partnerId);
  if (!advertised(envelope.actions, LOG_INTERACTION_ACTION)) {
    // The record is readable but this session is not offered the change it would make, so no form is rendered that the service would refuse. The reason is the envelope's to state; this route adds none.
    return (
      <div className={NOTICE_CLASS}>
        <StateNotice kind="denied" headingLevel={1} title={SURFACE_COPY.denied.title} description={SURFACE_COPY.denied.body} action={{ label: RETURN_LABEL, href: record }} />
      </div>
    );
  }
  return (
    <div className={PAGE_CLASS}>
      <div className={HEADING_BLOCK_CLASS}>
        {/* The record's own words are isolated from the surrounding direction, so a name carrying a right-to-left run cannot reorder the heading around it. */}
        <h1 className={TITLE_CLASS}>
          {HEADING_LEAD} <bdi>{partner.displayName}</bdi>
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">{HEADING_BODY}</p>
      </div>
      {/* One form for this job, composed with the authority the read reported and with nothing beside it: the subject is the record the read admitted, named by its opaque reference and the source that answered for it. The form states the negative rules itself — what an interaction records and what is never one — so this route does not repeat them; a second statement of one rule is a second place to keep it true. */}
      <InteractionForm scope={envelope.scope} partnerId={partner.partnerId} expectedRevision={envelope.revision} subject={{ partnerId: partner.partnerId, kind: partner.kind, displayName: partner.displayName, source: envelope.source }} />
      <p className="min-w-0">
        <Link href={record} className={RETURN_LINK_CLASS}>
          {RETURN_LABEL}
        </Link>
      </p>
    </div>
  );
}
