/** The generated workload's partner half through the real partner reads: the roster, one record body with its support history, the facet counts, the scope boundary and an unreadable workload. */ import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { reads } from "@/modules/data-service";
import type { SessionSource } from "@/modules/data-service/authorize";
import type { GiftRowRecord, PartnerRecord } from "@/modules/data-service/envelope";
import { DEFAULT_SESSION_ID, seed } from "@/modules/dev-runtime/seed";
import { minorUnitsOf } from "@/modules/money/amount";
import { resetSession } from "@/modules/store/repository";
import type { SessionDocuments } from "@/modules/store/paths";
const SESSION_ID = "it-workload-partners";
const SESSION: SessionSource = { sessionId: SESSION_ID };
const FIRST_PARTNER_ID = "partner-workload-00001";
const SECOND_PARTNER_ID = "partner-workload-00002";
const THIRD_PARTNER_ID = "partner-workload-00003";
const UNSTATED_PARTNER_ID = "partner-workload-00009";
const WORKLOAD_TAG = "workload-visit";
const FIRST_GIFT_MINOR_UNITS = 5_925;
const SECOND_GIFT_MINOR_UNITS = 10_000;
const PERIOD = { from: "2026-01-01", to: "2026-11-20" } as const;
const TIME_ZONE = "UTC";
type WorkloadFixture = { readonly header: { readonly coverage: { readonly from: string; readonly to: string; readonly state: "partial" }; readonly currencies: readonly string[] }; readonly partners: readonly PartnerRecord[]; readonly gifts: readonly GiftRowRecord[] };
/** The workload header the generator writes: the coverage its gift rows were generated over and the currencies they are stated in. */ const HEADER: WorkloadFixture["header"] = { coverage: { from: "2022-11-20", to: "2026-10-31", state: "partial" }, currencies: ["USD"] };
/** One generated partner in the shape the generator writes: an opaque `partner-workload-NNNNN` id and one permitted email address. */ function workloadPartner(partnerId: string, kind: PartnerRecord["kind"], displayName: string, tags: readonly string[], nameParts: PartnerRecord["nameParts"] = null): PartnerRecord {
  return { partnerId, kind, displayName, nameParts, contactMethods: [{ kind: "email", value: `${partnerId}@example.org`, permitted: true, verified: false }], restrictions: [], tags, favourite: false, stage: null, audience: "shared", source: { system: "crm", reference: partnerId }, revision: "rev-1" };
}
/** One generated gift row, attributed to the partner it names and dated inside the seed's current year. */ function workloadGift(index: number, partnerId: string, minorUnits: number, originalGiftOn: string): GiftRowRecord {
  const suffix = String(index).padStart(6, "0");
  const giftId = `gift-workload-${suffix}`;
  return {
    giftRowId: `gift-row-workload-${suffix}`,
    giftId,
    allocationId: null,
    amount: { currency: "USD", minorUnits: minorUnitsOf(minorUnits) },
    originalGiftOn,
    datePrecision: "date",
    designation: null,
    attribution: { kind: "partner", partnerId },
    refundOf: null,
    provenance: { system: "finance", reference: giftId },
    entryOn: originalGiftOn,
    revision: "rev-1",
  };
}
const WORKLOAD: WorkloadFixture = {
  header: HEADER,
  partners: [workloadPartner(FIRST_PARTNER_ID, "person", "Ada Adeyemi", [WORKLOAD_TAG], { given: "Ada", family: "Adeyemi", additional: [] }), workloadPartner(SECOND_PARTNER_ID, "household", "Adeyemi household", [WORKLOAD_TAG]), workloadPartner(THIRD_PARTNER_ID, "church", "Adeyemi Church", ["generated"])],
  gifts: [workloadGift(1, FIRST_PARTNER_ID, FIRST_GIFT_MINOR_UNITS, "2026-05-04"), workloadGift(2, FIRST_PARTNER_ID, SECOND_GIFT_MINOR_UNITS, "2026-06-15"), workloadGift(3, SECOND_PARTNER_ID, 4_250, "2026-07-01")],
};
type EnvelopeOf<Result> = Result extends { readonly kind: "envelope"; readonly envelope: infer Envelope } ? Envelope : never;
type RosterEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.partners.findPartners>>>;
type DetailEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.partners.readPartner>>>;
type FacetEnvelope = EnvelopeOf<Awaited<ReturnType<typeof reads.partners.readFacets>>>;
function envelopeOf<Envelope>(result: { readonly kind: string; readonly envelope?: Envelope }, job: string): Envelope {
  if (result.kind !== "envelope" || result.envelope === undefined) throw new Error(`The ${job} read answered "${result.kind}" instead of an envelope: ${JSON.stringify(result)}`);
  return result.envelope;
}
let sessionDocuments: SessionDocuments;
let unreadableWorkloadDocuments: SessionDocuments;
let seededPartnerCount = 0;
beforeAll(async () => {
  const base = (await seed()).find((session) => session.sessionId === DEFAULT_SESSION_ID);
  if (base === undefined) throw new Error(`The seed lays down no session "${DEFAULT_SESSION_ID}", so no workload partner read can start from the seeded world.`);
  seededPartnerCount = base.documents.state.partners.length;
  const state = { ...base.documents.state, context: { ...base.documents.state.context, sessionId: SESSION_ID } };
  sessionDocuments = { state, operations: base.documents.operations, meta: base.documents.meta, workload: WORKLOAD };
  unreadableWorkloadDocuments = { ...sessionDocuments, workload: { header: HEADER, partners: [{ partnerId: FIRST_PARTNER_ID }], gifts: WORKLOAD.gifts } }; // A workload this build cannot decode: one partner carrying only an identifier, which the stored record schema refuses.
});
beforeEach(async () => {
  await resetSession(SESSION_ID, sessionDocuments); // Laid down again before every case, so a sibling suite's reset of the shared store leaves this file's world as its assertions expect it.
});
afterAll(async () => await resetSession(SESSION_ID));
it("the generated workload's partners are readable: lists them in the roster beside the seeded records, with the gift rows attributed to them", async () => {
  const roster = envelopeOf<RosterEnvelope>(await reads.partners.findPartners({ page: { index: 0, size: 200 } }, SESSION), "findPartners");
  expect([roster.data.total, roster.data.rows.length]).toEqual([seededPartnerCount + WORKLOAD.partners.length, seededPartnerCount + WORKLOAD.partners.length]);
  for (const fixture of WORKLOAD.partners) expect(roster.data.rows.map((row) => row.partner.partnerId)).toContain(fixture.partnerId);
  const first = roster.data.rows.find((row) => row.partner.partnerId === FIRST_PARTNER_ID);
  if (first === undefined) throw new Error(`The roster states no row for the generated partner ${FIRST_PARTNER_ID}: ${JSON.stringify(roster.data.rows.map((row) => row.partner.partnerId))}`);
  expect([first.partner.kind, first.partner.displayName, first.partner.tags, first.partner.favourite, first.partner.stage, first.partner.audience, first.contactMethodKinds, first.givingCurrencies, first.lastReceivedOn]).toEqual([
    "person",
    "Ada Adeyemi",
    [WORKLOAD_TAG],
    false,
    null,
    "shared",
    ["email"],
    ["USD"],
    "2026-06-15",
  ]);
});
it("the generated workload's partners are readable: answers one generated record with the support history of the gift rows attributed to it", async () => {
  const detail = envelopeOf<DetailEnvelope>(await reads.partners.readPartner(FIRST_PARTNER_ID, { period: PERIOD, timeZone: TIME_ZONE }, SESSION), "readPartner");
  expect([detail.data.partner.partnerId, detail.data.partner.kind, detail.data.partner.displayName, detail.data.partner.tags]).toEqual([FIRST_PARTNER_ID, "person", "Ada Adeyemi", [WORKLOAD_TAG]]);
  const usd = (detail.data.supportHistory?.figures ?? []).find((figure) => figure.amount.currency === "USD");
  if (usd === undefined) throw new Error(`The record's support history states no USD figure, so the workload gift rows attributed to it were not read: ${JSON.stringify(detail.data.supportHistory?.figures ?? [])}`);
  expect(usd.amount.minorUnits).toBe(FIRST_GIFT_MINOR_UNITS + SECOND_GIFT_MINOR_UNITS);
  expect(detail.valueStates[usd.path]).toBe("incomplete-subtotal"); // The coverage the figures were read over is partial, so the envelope states the figure's exact amount as a subtotal rather than as a whole period's value.
  expect((detail.data.supportHistory?.gifts ?? []).map((entry) => entry.gift.giftRowId).sort()).toEqual(["gift-row-workload-000001", "gift-row-workload-000002"]);
  expect(detail.coverage).toEqual({ from: "2022-11-20", to: "2026-10-31", state: "partial" }); // The header's coverage is merged over the seeded projection's own, so the record states the history its figures were read over rather than the seed's alone.
});
it("the generated workload's partners are readable: counts them in the facet set the roster offers", async () => {
  const facets = envelopeOf<FacetEnvelope>(await reads.partners.readFacets({ period: PERIOD, timeZone: TIME_ZONE }, SESSION), "readFacets");
  const tagFacet = facets.data.find((facet) => facet.id === "tag");
  if (tagFacet === undefined) throw new Error(`The facet set offers no tag filter: ${JSON.stringify(facets.data.map((facet) => facet.id))}`);
  expect(tagFacet.options.find((option) => option.id === WORKLOAD_TAG)).toEqual(expect.objectContaining({ count: 2, countState: "value" })); // The tag the fixture states is carried by its two generated partners and by no seeded record, so its count is theirs alone.
  const kindFacet = facets.data.find((facet) => facet.id === "contact-type");
  if (kindFacet === undefined) throw new Error(`The facet set offers no contact-type filter: ${JSON.stringify(facets.data.map((facet) => facet.id))}`);
  const roster = envelopeOf<RosterEnvelope>(await reads.partners.findPartners({ page: { index: 0, size: 1 } }, SESSION), "findPartners");
  expect(kindFacet.options.reduce((total, option) => total + option.count, 0)).toBe(roster.data.total);
  expect(roster.data.total).toBe(seededPartnerCount + WORKLOAD.partners.length);
});
it("the generated workload's partners are readable: still refuses a partner stated in neither document", async () => {
  const detail = await reads.partners.readPartner(UNSTATED_PARTNER_ID, {}, SESSION);
  expect(detail.kind).toBe("denied");
  if (detail.kind !== "denied") throw new Error(`readPartner answered "${detail.kind}" for a partner neither document states.`);
  expect([detail.denied.reasonCode, (await reads.partners.readPrivatePreparation({ partnerId: UNSTATED_PARTNER_ID }, SESSION)).kind]).toEqual(["no-permission", "denied"]);
});
it("the generated workload's partners are readable: refuses the read rather than answering a partial roster when the workload cannot be read", async () => {
  await resetSession(SESSION_ID, unreadableWorkloadDocuments);
  const roster = await reads.partners.findPartners({ page: { index: 0, size: 200 } }, SESSION);
  expect(roster.kind).toBe("unavailable");
  if (roster.kind !== "unavailable") throw new Error(`findPartners answered "${roster.kind}" for a workload document it cannot decode.`);
  expect(roster.unavailable.guidance.length).toBeGreaterThan(0);
});
