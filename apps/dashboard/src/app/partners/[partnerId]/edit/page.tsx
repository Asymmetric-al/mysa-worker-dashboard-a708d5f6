/**
 * `/partners/[partnerId]/edit` — the permitted-field edit of one partner record.
 *
 * A record's contact fields are changed against the revision the record was read at, so a save somebody else overtook
 * comes back as a conflict that compares the current value with what this worker entered, rather than as a silent
 * overwrite. This route is composition and nothing else: it issues the one named read for the record and hands that
 * read's own answer on. The family's edit form owns the fields, the revision it presents and every outcome; the shared
 * state notice owns every answer that is not an envelope; the family's copy owns the wording. No field list, permission
 * rule, payload, revision or outcome is derived here, and no state lives here.
 *
 * The read resolves the organisation, ministry, support subject and principal from the development-session cookie, so
 * this address supplies the record's opaque identifier and nothing that could invent authority. A refusal therefore
 * states itself without naming a record, a count, a title or a size, and is never turned into a "not found" that would
 * answer the same question with a different signal.
 */
import Link from "next/link";
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import { buttonVariants } from "@/components/ui/button";
import PartnerEditForm from "@/features/partners/components/partner-edit-form";
import { PARTNER_ACTION_LABELS, SURFACE_STATE_COPY } from "@/features/partners/copy/states";
import { reads, type ReadAction } from "@/modules/data-service";

/** The route family this record lives under, so the links this page draws and the addresses it is reached by agree. */
const ROSTER_HREF = "/partners";

/** The suffix this route adds to a record's own address. */
const EDIT_SUFFIX = "/edit";

/** The write this page presents, as the record's own advisory `actions` list names it. */
const EDIT_ACTION = "saveContactEdits";

/**
 * The family's own sentences for a record surface that this context does not answer. A page reaches for the wording
 * the family already states rather than writing a second version of it.
 */
const DETAIL_COPY = SURFACE_STATE_COPY["partner-detail"];

/** The heading this route adds to the record it edits: the record's own name follows it, isolated for mixed direction. */
const HEADING_PREFIX = "Edit";

/** The one link this page draws, named by where it goes rather than by the direction it travels. */
const RETURN_LABEL = "Return to this record";

/** The page column and its type scale, so this file states no spacing or size a section then repeats. */
const PAGE_COLUMN = "flex min-w-0 flex-col gap-6 text-start";

const HEADING = "text-2xl font-semibold text-pretty wrap-anywhere";

const HEADER = "flex min-w-0 flex-col gap-3";

/** The 24x24 CSS px floor of WCAG 2.2 Target Size Minimum, on the one control this page renders itself; `self-start` keeps it the width of its own words in the column above the form. */
const RETURN_LINK = "min-h-target max-w-full self-start whitespace-normal";

/** Props of {@link PartnerEditPage}: Next hands a Server Component the request's dynamic segments as a promise. */
export interface PartnerEditPageProps {
  readonly params: Promise<{ partnerId: string }>;
}

/**
 * A record belongs to one session's context, so no rendered page may be cached across a context switch or a
 * restriction taking effect: the read resolves this request's cookie on every render.
 */
export const dynamic = "force-dynamic";

/**
 * The address of one record's own page, from its opaque identifier and never from its details. The identifier is
 * encoded where it addresses a route and reaches the read exactly as it arrived: never parsed, split or compared.
 */
function recordHref(partnerId: string): string {
  return `${ROSTER_HREF}/${encodeURIComponent(partnerId)}`;
}

/** The address this page was reached at, which is the one retry an outage of this read can offer without guessing. */
function editHref(partnerId: string): string {
  return `${recordHref(partnerId)}${EDIT_SUFFIX}`;
}

/**
 * Whether the record's own advisory actions leave a permitted-field edit available in this context. The list is
 * advisory only — the write re-checks scope and permission on submit — so this decides what may be drawn here, never
 * whether a save will succeed.
 */
function editAdmission(actions: readonly ReadAction[]): { readonly admitted: boolean; readonly reason: string | null } {
  const action = actions.find((candidate) => candidate.name === EDIT_ACTION);
  if (action === undefined || !action.available) {
    const reason = action?.reason?.trim();
    return { admitted: false, reason: reason === undefined || reason === "" ? null : reason };
  }
  return { admitted: true, reason: null };
}

/** The permitted-field edit of one partner record, composed from the service's own read of that record. */
export default async function PartnerEditPage({ params }: PartnerEditPageProps): Promise<ReactElement> {
  const { partnerId } = await params;
  // One read of one named job. The organisation, ministry, support subject and principal are derived by the service
  // from this session, so the route states the record's identifier and nothing else.
  const result = await reads.partners.readPartner(partnerId);
  switch (result.kind) {
    case "denied":
      // The closed reason code is the whole answer a refusal carries: no name, count, title or size travels with it, so
      // nothing here can hint at what the caller may not read. The shell owns the context switch, so the recovery this
      // route can offer is the roster.
      return (
        <div className={PAGE_COLUMN}>
          <StateNotice kind="denied" headingLevel={1} title={DETAIL_COPY.denied.title} description={DETAIL_COPY.denied.body} reasonCode={result.denied.reasonCode} action={{ label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF }} />
        </div>
      );
    case "unavailable":
      // The source behind this record did not answer, so the record is reported as unavailable and never as an empty
      // one. Retrying asks for this same read at this same address, because a read that failed proves nothing about
      // whether the record exists, whether it admits an edit, or what it holds.
      return (
        <div className={PAGE_COLUMN}>
          <StateNotice kind="unavailable" headingLevel={1} title={DETAIL_COPY.unavailable.title} description={DETAIL_COPY.unavailable.body} source={result.unavailable.source} action={{ label: PARTNER_ACTION_LABELS.retry, href: editHref(partnerId) }} />
        </div>
      );
    case "refused":
      // The address this page was opened at is not one the read admits, so nothing was read and the record source did
      // not fail. Stating the refusal here is what keeps a request this route should never send from reading as an
      // outage or as a record that holds nothing.
      return (
        <div className={PAGE_COLUMN}>
          <StateNotice kind="refused" headingLevel={1} title={DETAIL_COPY.refused.title} description={DETAIL_COPY.refused.body} action={{ label: PARTNER_ACTION_LABELS.backToRoster, href: ROSTER_HREF }} />
        </div>
      );
    case "envelope": {
      const { envelope } = result;
      const admission = editAdmission(envelope.actions);
      if (!admission.admitted) {
        // No form is drawn for a record whose own actions leave a permitted-field change unavailable: a disabled field
        // would suggest the edit is only temporarily out of reach, when what is absent is the permission. The record's
        // stated reason is preferred where it gives one, exactly as the edit form itself prefers it.
        return (
          <div className={PAGE_COLUMN}>
            <StateNotice kind="denied" headingLevel={1} title={DETAIL_COPY.denied.title} description={admission.reason ?? DETAIL_COPY.denied.body} action={{ label: RETURN_LABEL, href: recordHref(partnerId) }} />
          </div>
        );
      }
      const displayName = envelope.data.partner.displayName;
      return (
        <div className={PAGE_COLUMN}>
          <div className={HEADER}>
            {/* The one h1 on this page: it names the record being edited, and the form below opens its own section at
                level two. The name is isolated so a mixed-direction value cannot reorder the sentence around it. */}
            <h1 className={HEADING}>
              {HEADING_PREFIX} <bdi>{displayName}</bdi>
            </h1>
            <Link href={recordHref(partnerId)} className={`${buttonVariants({ variant: "outline", size: "sm" })} ${RETURN_LINK}`}>
              {RETURN_LABEL}
            </Link>
          </div>
          {/* The envelope travels on untouched: the revision it carries becomes the `expectedRevision` of every save,
              and the actions it carries decide what the form offers. Nothing typed here is cleared by a refused,
              conflicting or unconfirmed save, because the form owns those answers and the text this worker entered. */}
          <PartnerEditForm partnerRef={partnerId} envelope={envelope} />
        </div>
      );
    }
  }
}
