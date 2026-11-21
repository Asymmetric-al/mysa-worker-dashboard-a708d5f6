/**
 * The referrals list transport reads the wire the handler actually writes.
 *
 * One response builder answers every read, and it flattens the read result onto the status: 200
 * carries the envelope itself, 403 the denial and 503 the outage, and none of the three is wrapped in
 * a `kind`. A transport that only looked for the wrapped form would call every real answer an outage,
 * so all three lists would render as a source that never answered — which is the one thing a list
 * that could not be read must never be confused with. These cases pin the handler's four real
 * answers, plus the ways a request ends without one, against a stubbed `fetch`: no store, no
 * server, no network and no clock, so the file proves the transport's own reading and nothing else.
 *
 * The flat envelope below is hand-written to the shape `GET /api/referrals` answers with, and its row
 * is one the list read really builds: what the transport owes the view is that payload, intact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchReferralRead, REFERRALS_ENDPOINT, type ReferralListPage } from "@/features/referrals/hooks/use-referrals";
// The transport's import graph holds one React client module — the query key's scope segments, which
// belong to the context-switch guard — and the no-DOM runner cannot parse it. The transport under test
// never reads a query key, so the substitute answers nothing: a call to it would be a defect this file
// reports rather than a value it fabricates.
vi.mock("@/components/context-switch-guard", () => ({
  scopeKey: () => {
    throw new Error("The referral list transport reads no query key.");
  },
}));
const LIST_PATH = `${REFERRALS_ENDPOINT}?list=active&page=1&pageSize=50`;
/** The one page of one list the envelope cases carry, shaped as the read builds it. */
const LIST_PAGE = {
  list: "active",
  items: [
    {
      referralId: "referral-kenji-active",
      partnerDisplayName: "Kenji Nakamura",
      datePrecision: "date",
      originalIntroductionOn: "2026-11-12",
      cycleIndex: 0,
      windowKind: "new",
      windowStart: "2026-11-12T00:00:00Z",
      windowEnd: "2026-11-26T00:00:00Z",
      status: "active",
      statusReason: null,
      consumed: false,
      continuation: {
        available: false,
        reason: "This referral's window has not ended, so there is nothing to continue.",
        cycle: { consumed: false, successorId: null },
      },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  continuationPolicy: { setting: "on", reason: null },
} as const;
/** The whole body a 200 `GET /api/referrals` answers with: the envelope itself, with no `kind` around it. */
const FLAT_ENVELOPE = {
  data: LIST_PAGE,
  scope: {
    organizationId: "org-harbour",
    ministryId: "min-harbour-youth",
    supportSubjectId: "sup-harbour-youth",
    principalId: "principal-established-worker",
  },
  source: { system: "local-store", reference: "outreach" },
  revision: "rev-2",
  asOf: "2026-11-20T00:00:00Z",
  coverage: { from: "2026-11-12", to: "2026-11-26", state: "complete" },
  valueStates: { "page.total": "value" },
  actions: [
    { name: "recordIntroduction", available: true },
    { name: "readReferral", available: true },
  ],
} as const;
/** The body a 403 carries: the denial the service built, and nothing about the records it refused. */
const DENIED_BODY = {
  outcome: "denied",
  operationId: "read",
  reasonCode: "no-permission",
} as const;
/** The body a 503 carries: the outage naming the source that did not answer. */
const UNAVAILABLE_BODY = {
  outcome: "unavailable",
  operationId: "read",
  source: { system: "local-store", reference: "outreach" },
  guidance: "The referral records could not be read from the store. Retry this view.",
} as const;
/** The source the folder's own outage names, so a reader is told which source did not answer. */
const FOLDER_SOURCE = { system: "local-store", reference: "outreach" };
const ORIGINAL_FETCH = globalThis.fetch;
let requestedPaths: string[] = [];
beforeEach(() => {
  requestedPaths = [];
});
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});
function jsonAnswer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
/** Replaces the one external boundary the transport crosses: the request that leaves the browser. */
function answerWith(reply: () => Promise<Response>): void {
  globalThis.fetch = async (input) => {
    requestedPaths.push(String(input));
    return reply();
  };
}
describe("the referrals list transport", () => {
  it("reads a 200 flat envelope as the envelope, with its payload intact", async () => {
    answerWith(async () => jsonAnswer(200, FLAT_ENVELOPE));
    const result = await fetchReferralRead<ReferralListPage>(LIST_PATH);
    expect(requestedPaths).toEqual([LIST_PATH]);
    expect(result.kind).toBe("envelope");
    if (result.kind !== "envelope") {
      throw new Error(`The flat envelope was read as ${result.kind}.`);
    }
    expect(result.envelope.data).toEqual(LIST_PAGE);
    expect(result.envelope.revision).toBe("rev-2");
    expect(result.envelope.source).toEqual(FLAT_ENVELOPE.source);
    expect(result.envelope.valueStates).toEqual(FLAT_ENVELOPE.valueStates);
  });
  it("reads a 403 denial as denied, never as an empty list", async () => {
    answerWith(async () => jsonAnswer(403, DENIED_BODY));
    const result = await fetchReferralRead<ReferralListPage>(LIST_PATH);
    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") {
      throw new Error(`The denial was read as ${result.kind}.`);
    }
    expect(result.denied).toEqual(DENIED_BODY);
    expect("envelope" in result).toBe(false);
  });
  it("reads a 503 outage as unavailable, carrying the source that did not answer", async () => {
    answerWith(async () => jsonAnswer(503, UNAVAILABLE_BODY));
    const result = await fetchReferralRead<ReferralListPage>(LIST_PATH);
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") {
      throw new Error(`The outage was read as ${result.kind}.`);
    }
    expect(result.unavailable).toEqual(UNAVAILABLE_BODY);
    expect("envelope" in result).toBe(false);
  });
  it.each([
    { answer: "a request that never reaches the application", reply: () => Promise.reject(new TypeError("fetch failed")) },
    { answer: "a 200 body that is not an envelope", reply: async () => jsonAnswer(200, LIST_PAGE) },
    { answer: "a body that is not JSON", reply: async () => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) },
    { answer: "a status that is none of the three", reply: async () => jsonAnswer(500, { message: "Internal Server Error" }) },
  ])("answers the folder's own outage for $answer, never an empty list", async ({ reply }) => {
    answerWith(reply);
    const result = await fetchReferralRead<ReferralListPage>(LIST_PATH);
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") {
      throw new Error(`The answer was read as ${result.kind}.`);
    }
    expect("envelope" in result).toBe(false);
    expect(result.unavailable.outcome).toBe("unavailable");
    expect(result.unavailable.source).toEqual(FOLDER_SOURCE);
    expect(result.unavailable.guidance).not.toBe("");
  });
});
