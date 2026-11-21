/**
 * `GET /api/inbox` — the receiving persona's synthetic inbox: one produced message per recipient and
 * notification intent, each carrying its rendered HTML beside its plain-text rendition.
 */
import { outcomeFromError, reads, toResponse } from "@/modules/data-service";
/** The store behind the service reads its session documents through `node:fs`, so this handler never runs on the edge runtime. */
export const runtime = "nodejs";
/** The session, the selected context and the scenario instant are resolved per request, so an unsubscribe takes effect on the very next read rather than in a stored render. */
export const dynamic = "force-dynamic";

const READ_ATTEMPT_MARKER = "read";

/** A paging value exactly as a URL states one: digits, and nothing else. */
const WHOLE_NUMBER = /^\d{1,9}$/;

function pageValue(raw: string | null): number | undefined {
  if (raw === null) {
    return undefined;
  }
  const stated = raw.trim();
  return WHOLE_NUMBER.test(stated) ? Number(stated) : undefined;
}

/**
 * Reads one page of this reader's inbox, one message per recipient and notification intent.
 * Answers the read envelope, or the read's own `denied` and `unavailable` outcomes.
 */
export async function GET(request: Request): Promise<Response> {
  // Only a paging window is taken from the URL. The recipient is the session the service resolves,
  // never a parameter, so no request can address another reader's inbox — and nothing here echoes a
  // value back, since an inbox may hold an address, a subject and a message body.
  const search = new URL(request.url).searchParams;
  const page = pageValue(search.get("page"));
  const pageSize = pageValue(search.get("pageSize"));
  // A value the read cannot place is dropped rather than refused: the service applies its own page
  // and size, which is a paging window this request never stated.
  const query = {
    ...(page === undefined ? {} : { page }),
    ...(pageSize === undefined ? {} : { pageSize }),
  };
  try {
    return toResponse(await reads.audience.readInbox(query));
  } catch (error) {
    // A throw is a defect rather than a presentation: the read answers its refusals as results, so a
    // throw means a store or medium fault, or a failure whose fate is not known.
    return toResponse(outcomeFromError(READ_ATTEMPT_MARKER, error));
  }
}
