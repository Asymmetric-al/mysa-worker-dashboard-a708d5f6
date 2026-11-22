/**
 * `/communication/delivery` — the recorded per-send results of one submitted notice, kept as the three
 * outcomes that never merge: acceptance, a definite failure and an unknown result.
 *
 * Composition only. `DeliveryResults` owns the rows, each recipient's pinned copy, the four-part dedupe
 * identity, the counts and the one recovery a read can offer. No deadline and no copy identity is derived
 * here: the instant the usefulness window closes at and the rendition each recipient was pinned to are the
 * read's own values, so this route cannot state that a repeat is still permitted when the record it reports
 * on says the window has closed.
 */
import type { ReactElement } from "react";
import StateNotice from "@/components/state-notice";
import DeliveryResults from "@/features/updates/components/delivery-results";
import { reads } from "@/modules/data-service";

type SearchParams = Record<string, string | string[] | undefined>;

type SendResultQuery = NonNullable<Parameters<typeof reads.audience.readSendResult>[0]>;

const PAGE_HEADING_LEVEL = 1;

const SECTION_HEADING_LEVEL = 2;

const DELIVERY_HREF = "/communication/delivery";

const UPDATES_HREF = "/communication";

const PARAM = { intentId: "intentId", page: "page", pageSize: "pageSize" } as const;

const WHOLE_NUMBER = /^\d{1,9}$/u;

/** The interface locale the composed surface formats its counts in. */
const INTERFACE_LOCALE = "en-GB";

const EMPTY_ACTION = { label: "Open the Updates list", href: UPDATES_HREF } as const;

const PAGE_COPY = {
  title: "Delivery",
  lede:
    "This screen reports the outcomes the application recorded for one submitted notice. Accepted means the " +
    "simulated submission step took that copy for that recipient, which is neither an arrival nor a reading. " +
    "Failed is definite and repeatable only inside the notice's usefulness window, and unknown means the " +
    "effect may have happened while its acknowledgement was lost, so that row is recovered by reading this " +
    "notice again rather than by submitting anything twice.",
  unnamed: { title: "No submitted notice is named", description: "This screen reports the recorded outcomes of one submitted notice, under that notice's own identity. " + "Nothing is counted and no notice is guessed until one is named, because a guess would report " + "whichever notice was submitted last." },
  denied: { title: "These results are not available in this session", description: "This session may not read the recorded outcomes for this notice, so no recipient, count, copy or " + "window is stated here: a refusal is not an empty result." },
  unavailable: { title: "The recorded outcomes could not be read" },
  refused: { title: "This screen's request was refused" },
  retry: "Try this read again",
} as const;

function paramOf(searchParams: SearchParams, name: string): string | undefined {
  const value = searchParams[name];
  const first = Array.isArray(value) ? value[0] : value;
  const stated = first?.trim();
  return stated === undefined || stated === "" ? undefined : stated;
}

function wholeNumberOf(value: string | undefined): number | undefined {
  if (value === undefined || !WHOLE_NUMBER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function queryOf(intentId: string, searchParams: SearchParams): SendResultQuery {
  const page = wholeNumberOf(paramOf(searchParams, PARAM.page));
  const pageSize = wholeNumberOf(paramOf(searchParams, PARAM.pageSize));
  return { intentId, ...(page === undefined ? {} : { page }), ...(pageSize === undefined ? {} : { pageSize }) };
}

function addressOf(intentId: string, searchParams: SearchParams): string {
  const query = new URLSearchParams();
  query.set(PARAM.intentId, intentId);
  const page = paramOf(searchParams, PARAM.page);
  if (page !== undefined) {
    query.set(PARAM.page, page);
  }
  const pageSize = paramOf(searchParams, PARAM.pageSize);
  if (pageSize !== undefined) {
    query.set(PARAM.pageSize, pageSize);
  }
  return `${DELIVERY_HREF}?${query.toString()}`;
}

function unhandledAnswer(answer: never): never {
  throw new Error(`Unhandled send-result answer: ${JSON.stringify(answer)}`);
}

export interface CommunicationDeliveryPageProps {
  readonly searchParams: Promise<SearchParams>;
}

export default async function CommunicationDeliveryPage({ searchParams }: CommunicationDeliveryPageProps): Promise<ReactElement> {
  const stated = await searchParams;
  const intentId = paramOf(stated, PARAM.intentId);
  // A notice is never guessed: the read requires one, and answering its denial for an unnamed notice would
  // report a permission refusal where nothing was asked for, which is the blurring of states this build keeps
  // apart. Landing here unnamed therefore states exactly that, with the list that names a notice.
  if (intentId === undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-6 text-start">
        <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_COPY.title}</h1>
        <StateNotice kind="empty" headingLevel={SECTION_HEADING_LEVEL} title={PAGE_COPY.unnamed.title} description={PAGE_COPY.unnamed.description} action={EMPTY_ACTION} />
      </div>
    );
  }
  const result = await reads.audience.readSendResult(queryOf(intentId, stated));
  switch (result.kind) {
    case "envelope":
      return (
        <div className="flex min-w-0 flex-col gap-6 text-start">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-2xl font-semibold text-pretty wrap-anywhere">{PAGE_COPY.title}</h1>
            <p className="max-w-prose text-sm text-pretty text-muted-foreground">{PAGE_COPY.lede}</p>
          </div>
          <DeliveryResults scope={result.envelope.scope} locale={INTERFACE_LOCALE} intentId={intentId} initialData={result} headingLevel={SECTION_HEADING_LEVEL} />
        </div>
      );
    case "denied":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="denied" headingLevel={PAGE_HEADING_LEVEL} title={PAGE_COPY.denied.title} description={PAGE_COPY.denied.description} reasonCode={result.denied.reasonCode} />
        </div>
      );
    case "unavailable":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="unavailable" headingLevel={PAGE_HEADING_LEVEL} title={PAGE_COPY.unavailable.title} description={result.unavailable.guidance} source={result.unavailable.source} action={{ label: PAGE_COPY.retry, href: addressOf(intentId, stated) }} />
        </div>
      );
    case "refused":
      return (
        <div className="flex min-w-0 flex-col gap-4 text-start">
          <StateNotice kind="refused" headingLevel={PAGE_HEADING_LEVEL} title={PAGE_COPY.refused.title} />
        </div>
      );
  }
  return unhandledAnswer(result);
}
