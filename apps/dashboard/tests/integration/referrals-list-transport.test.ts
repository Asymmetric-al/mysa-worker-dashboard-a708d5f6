/** The referrals list transport reads the wire the handler actually writes. */
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
      continuation: { available: false, reason: "This referral's window has not ended, so there is nothing to continue.", cycle: { consumed: false, successorId: null } },
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
  scope: { organizationId: "org-harbour", ministryId: "min-harbour-youth", supportSubjectId: "sup-harbour-youth", principalId: "principal-established-worker" },
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
const DENIED_BODY = { outcome: "denied", operationId: "read", reasonCode: "no-permission" } as const;
/** The body a 401 carries: the same denial, keyed to the session's own fault rather than to the caller's authority. */
const SESSION_DENIED_BODY = { outcome: "denied", operationId: "read", reasonCode: "session-expired" } as const;
/** The body a 503 carries: the outage naming the source that did not answer. */
const UNAVAILABLE_BODY = { outcome: "unavailable", operationId: "read", source: { system: "local-store", reference: "outreach" }, guidance: "The referral records could not be read from the store. Retry this view." } as const;
/** The body a 422 carries: the field-keyed refusal of a request the read does not admit, keyed at the caller's own field. */
const REFUSED_BODY = { outcome: "invalid", operationId: "read", fields: { page: ["State the page as a whole number from 1."] } } as const;
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
  it("reads a 401 session denial as denied, never as an outage", async () => {
    answerWith(async () => jsonAnswer(401, SESSION_DENIED_BODY));
    const result = await fetchReferralRead<ReferralListPage>(LIST_PATH);
    expect(result.kind).toBe("denied");
    if (result.kind !== "denied") {
      throw new Error(`The session denial was read as ${result.kind}.`);
    }
    // A session that expired is a refusal, not a source that did not answer: rendering it as an outage
    // would offer a retry that cannot help, and would lose the reason code that says why.
    expect(result.denied).toEqual(SESSION_DENIED_BODY);
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
  it("reads a 422 refused request as refused, never as an outage", async () => {
    answerWith(async () => jsonAnswer(422, REFUSED_BODY));
    const result = await fetchReferralRead<ReferralListPage>(LIST_PATH);
    // The page this request stated is not one the list read admits. Reporting it as an outage would tell
    // the worker the referral records failed to arrive when the request was what had to be corrected.
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error(`The refusal was read as ${result.kind}.`);
    }
    expect(result.refused).toEqual(REFUSED_BODY);
    expect("envelope" in result).toBe(false);
    expect("unavailable" in result).toBe(false);
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
