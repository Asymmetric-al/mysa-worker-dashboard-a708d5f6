/** The record a gift address names: the integration half of the direct-route requirement, driven through the real store and the real service read, so a gift opens from its own address in the period its own evidence sits on rather than in whichever period the ledger defaults to. */
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { giftsQueryFromSearch, supportQueryFromSearch } from "@/app/api/support/query";
import { reads } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import { DEFAULT_SESSION_ID, seed } from "@/modules/dev-runtime/seed";
import type { SessionDocuments } from "@/modules/store/paths";
import { resetSession } from "@/modules/store/repository";
import { expectEnvelope, firstSaying } from "../helpers/answers";
const SESSION_ID = "it-gift-record";
const SESSION: SessionSource = { sessionId: SESSION_ID };
/** The correction the seed records on 2026-09-01, which the ledger's this-month default never covers, named by its gift and by its own row. */ const RECORD_GIFT_ID = "gift-harbour-0010";
const RECORD_ROW_ID = "gift-row-harbour-0010";
const RECORD_DAY = "2026-09-01";
/** The row that correction is recorded against, on 2026-07-05: naming it has to keep the correction in the same result. */ const CORRECTED_GIFT_ID = "gift-harbour-0009";
const CORRECTED_ROW_ID = "gift-row-harbour-0009";
const CORRECTED_DAY = "2026-07-05";
/** An identifier the projection holds no row or gift for: a genuinely absent record, not a filter that excludes one. */ const UNSOURCED_RECORD = "gift-harbour-9999";
/** A currency the named record is not stated in. */ const OTHER_CURRENCY = "EUR";
type GiftQuery = NonNullable<Parameters<typeof reads.support.readGifts>[0]>;
type GiftsResult = Awaited<ReturnType<typeof reads.support.readGifts>>;
type GiftsEnvelope = Extract<GiftsResult, { readonly kind: "envelope" }>["envelope"];
type LedgerRow = GiftsEnvelope["data"]["report"]["rows"][number];
const giftEnvelope = async (query: GiftQuery): Promise<GiftsEnvelope> => expectEnvelope(await reads.support.readGifts(query, SESSION), `The gifts read for ${JSON.stringify(query)}`);
const rowIdsOf = (rows: readonly LedgerRow[]): readonly string[] => rows.map((row) => row.giftRowId);
const daysOf = (envelope: GiftsEnvelope): readonly string[] => [String(envelope.data.report.snapshot.period.from), String(envelope.data.report.snapshot.period.to)];
let sessionDocuments: SessionDocuments;
beforeAll(async () => {
  const base = firstSaying(await seed(), "sessionId", DEFAULT_SESSION_ID, `The seed lays down no session "${DEFAULT_SESSION_ID}", so no gift record case can start from the seeded world.`);
  sessionDocuments = { state: { ...base.documents.state, context: { ...base.documents.state.context, sessionId: SESSION_ID } }, operations: base.documents.operations, meta: base.documents.meta };
});
beforeEach(async () => {
  await resetSession(SESSION_ID, sessionDocuments); // Laid down before every case, so a sibling suite's reset of the shared store leaves this file's world exactly as its assertions expect it, and so one case can never inherit another's writes.
});
afterAll(async () => {
  await resetSession(SESSION_ID);
});
it.each([RECORD_GIFT_ID, RECORD_ROW_ID])("answers the record named by its %s identifier in the period its own evidence sits on", async (record) => {
  const ledger = await giftEnvelope({});
  expect(rowIdsOf(ledger.data.report.rows)).not.toContain(RECORD_ROW_ID); // The baseline the case is about: the ledger's own default period does not reach this record.
  const envelope = await giftEnvelope({ record });
  expect([rowIdsOf(envelope.data.report.rows), daysOf(envelope), envelope.data.report.snapshot.query.period.kind]).toEqual([[RECORD_ROW_ID], [RECORD_DAY, RECORD_DAY], "explicit"]);
});
it("a gift record read from the address that names it: is not defeated by the period and the page the address still carries", async () => {
  const envelope = await giftEnvelope({ record: RECORD_GIFT_ID, period: { kind: "preset", preset: "this-month" }, page: { index: 3 } });
  expect([rowIdsOf(envelope.data.report.rows), envelope.data.report.snapshot.query.period.kind, envelope.data.report.snapshot.query.page]).toEqual([[RECORD_ROW_ID], "explicit", undefined]);
});
it("a gift record read from the address that names it: keeps the correction recorded against the named record in the same result", async () => {
  const envelope = await giftEnvelope({ record: CORRECTED_GIFT_ID });
  expect([daysOf(envelope), rowIdsOf(envelope.data.report.rows)]).toEqual([[CORRECTED_DAY, RECORD_DAY], expect.arrayContaining([CORRECTED_ROW_ID, RECORD_ROW_ID])]);
});
it("a gift record read from the address that names it: falls back to the ledger's own default period when the projection holds no such record", async () => {
  const ledger = await giftEnvelope({});
  const envelope = await giftEnvelope({ record: UNSOURCED_RECORD });
  expect([rowIdsOf(envelope.data.report.rows), envelope.data.report.total, envelope.data.report.snapshot.query.period]).toEqual([rowIdsOf(ledger.data.report.rows), ledger.data.report.total, ledger.data.report.snapshot.query.period]);
});
it("a gift record read from the address that names it: still applies every other filter the address states", async () => {
  const envelope = await giftEnvelope({ record: RECORD_GIFT_ID, currency: OTHER_CURRENCY });
  expect([envelope.data.report.snapshot.query.period.kind, envelope.data.report.total, rowIdsOf(envelope.data.report.rows)]).toEqual(["explicit", 0, []]);
});
it("the gifts request grammar: carries the record an address names into the query the read answers", () => {
  const parsed = giftsQueryFromSearch(new URLSearchParams(`record=${RECORD_GIFT_ID}&page=0&pageSize=50`));
  if (!parsed.ok) throw new Error(`A request naming a record must be parsed rather than refused: ${JSON.stringify(parsed.error.issues)}`);
  expect([parsed.value.record, parsed.value.page]).toEqual([RECORD_GIFT_ID, { index: 0, size: 50 }]);
});
it("the gifts request grammar: refuses a record stated as blank rather than reading the ledger without one", () => {
  const parsed = giftsQueryFromSearch(new URLSearchParams("record="));
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("A record stated as blank states no record the read could compare, so the request must be refused.");
  expect(parsed.error.issues.map((issue) => issue.path.join("."))).toEqual(["record"]);
});
it("the gifts request grammar: reads an address that names no record with the shared grammar, exactly as before the record was declared", () => {
  const parsed = giftsQueryFromSearch(new URLSearchParams("page=0&pageSize=50&period=this-year&currency=USD"));
  if (!parsed.ok) throw new Error(`The ledger's own address must be read, not refused: ${JSON.stringify(parsed.error.issues)}`);
  expect([parsed.value.record, parsed.value.page, parsed.value.period, parsed.value.currency]).toEqual([undefined, { index: 0, size: 50 }, { kind: "preset", preset: "this-year" }, "USD"]);
});
it("the gifts request grammar: names the record only on the read that narrows to one, so the overview refuses it rather than ignoring it", () => {
  const overview = supportQueryFromSearch(new URLSearchParams(`record=${RECORD_GIFT_ID}`));
  expect(overview.ok).toBe(false);
  if (overview.ok) throw new Error("The overview does not narrow to a record, so a record stated to it is a parameter it would ignore and must be refused by name.");
  expect(overview.error.issues.map((issue) => issue.path.join("."))).toEqual(["record"]);
});
