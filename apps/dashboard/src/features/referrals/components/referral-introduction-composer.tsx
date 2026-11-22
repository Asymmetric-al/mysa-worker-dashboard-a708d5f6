"use client";
/**
 * The referral introduction composer: the one surface that records an original introduction, and the only composition of
 * the family's introduction form.
 *
 * **Why a composer is needed at all.** `ReferralIntroductionForm` asks the worker only for the date the introduction
 * happened and the precision that date is known to, because every other part of its payload is a fact the record holds:
 * the partner the introduction refers to, the revision the view read, and the provenance — the source that issued the
 * reference and the zone the date is known in. Those facts are supplied here, so the delivered form keeps its single job
 * and no second copy of its date-and-precision logic exists.
 *
 * **No provenance is invented.** The source system, the source reference and the source zone are stated by the person
 * recording the introduction: a default system name, a generated reference or a zone taken from a display preference
 * would each be a claim the record makes and no source asserts, and a referral window read in a moved zone would end at
 * a moment the source never agreed to. Each value is validated by the family's own schema, so a refusal reads in the
 * schema's own words and sits on the control that carries the field name the service would name.
 *
 * **The form appears only once it can be submitted.** Until a partner is selected and all three provenance values parse,
 * this surface states which parts are still needed rather than offering a form whose submission the service would refuse.
 */
import { useCallback, useId, useState, type ReactElement } from "react";
import FormField from "@/components/form-field";
import { StateNotice } from "@/components/state-notice";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/cn";
import type { SourceReference } from "@/lib/ids";
import type { Scope } from "@/modules/data-service";
import { INTRODUCED_BY_COPY, LIST_COPY } from "../copy";
import { sourceReferenceSchema, sourceZoneSchema } from "../schemas";
import { ReferralIntroductionForm } from "./referral-introduction-form";
// The composer's own section, and the fragment the surfaces that offer the action link to
const COMPOSER_SECTION_ID = "record-introduction";
/** The address of this composer's own section, stated once so the control a surface offers and the section it lands on cannot drift apart. */
export const INTRODUCTION_COMPOSER_ANCHOR = `#${COMPOSER_SECTION_ID}`;
// The field names the shared refusal summary anchors to
//
// Each is the payload's own path, because the aggregate summary a refused submission renders looks the control up by
// that path: a provenance refusal raised by the service must land on the control that states the value, not on the form.
const PARTNER_FIELD = "partnerId";
const SOURCE_ZONE_FIELD = "sourceZone";
/** The two field paths inside a reference pair, as that schema's own refusal names them and as the controls address them. */
const SYSTEM_PAIR_FIELD = "system";
const REFERENCE_PAIR_FIELD = "reference";
const SOURCE_SYSTEM_FIELD = `sourceReference.${SYSTEM_PAIR_FIELD}`;
const SOURCE_REFERENCE_FIELD = `sourceReference.${REFERENCE_PAIR_FIELD}`;
/** One partner the composing route offers for selection: the opaque identity the mutation takes, and the name it is offered under. */
export interface ReferralIntroductionCandidate {
  readonly partnerId: string;
  readonly displayName: string;
}
/** The candidate read the composing route supplies: the eligible partners themselves, or the reason it could not enumerate them. */
export type ReferralIntroductionCandidates = { readonly state: "available"; readonly partners: readonly ReferralIntroductionCandidate[] } | { readonly state: "unavailable"; readonly source: SourceReference };
/** Props of {@link ReferralIntroductionComposer}. */
export interface ReferralIntroductionComposerProps {
  /** The exact authority the record is made in; the service re-derives scope from it on submit. */
  readonly scope: Scope;
  /** The revision of the referral collection this view read: the change is refused as a conflict once it has moved. */
  readonly expectedRevision: string;
  /** The eligible partners, or the same read's `unavailable` refusal. Never a set this component computes. */
  readonly candidates: ReferralIntroductionCandidates;
  readonly className?: string;
}
/** Where each part of the record's provenance is stated, so the three controls and the gated form read from one shape. */
interface ProvenanceValues {
  readonly system: string;
  readonly reference: string;
  readonly sourceZone: string;
}
const NO_PROVENANCE: ProvenanceValues = { system: "", reference: "", sourceZone: "" };
const NO_PARTNERS: readonly ReferralIntroductionCandidate[] = [];
const COMPOSER_COPY = {
  heading: LIST_COPY.recordIntroductionLabel,
  help: "An introduction is recorded against the partner it happened with, and the date it happened becomes day one of that referral's window.",
  partnerLabel: LIST_COPY.columns.partner,
  partnerPlaceholder: "Choose the partner who was introduced",
  systemLabel: "Source system",
  referenceLabel: INTRODUCED_BY_COPY.sourceReferenceLabel,
  zoneLabel: INTRODUCED_BY_COPY.sourceZoneLabel,
  systemHelp: "The system that issued the reference, named as it names itself. It is provenance for this record and never a key for matching one record against another.",
  referenceHelp: INTRODUCED_BY_COPY.sourceReferenceHelp,
  zoneHelp: INTRODUCED_BY_COPY.sourceZoneHelp,
  needed: (parts: string): string => `Still needed before this introduction can be recorded: ${parts}.`,
  partnerPart: "a partner who was introduced",
  systemPart: "the source system",
  referencePart: "the source reference",
  zonePart: "the time zone this date is known in",
  unavailableTitle: "The eligible partners could not be read",
  unavailableBody: "The source behind the eligible partners did not answer, so this surface offers no partner rather than an empty list or a count of zero.",
  noPartnerTitle: "No shared partner is available to record an introduction against",
  noPartnerBody: "A private preparation record is a different record class from a shared relationship, so it can never be the partner of a referral, and every partner this read could offer is one.",
} as const;
/** The messages a reference pair's refusal states, keyed by the field each one is about, in the schema's own words. */
function referenceRefusalMessages(parsed: ReturnType<typeof sourceReferenceSchema.safeParse>): Readonly<Record<string, string | undefined>> {
  if (parsed.success) {
    return {};
  }
  const messages: Record<string, string | undefined> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.map(String).join(".");
    if (messages[field] === undefined) {
      messages[field] = issue.message;
    }
  }
  return messages;
}
/** The parts the record still needs, as one sentence in the order the controls are read. */
function stillNeededSentence(parts: readonly string[]): string | null {
  if (parts.length === 0) {
    return null;
  }
  const last = parts[parts.length - 1] ?? "";
  const rest = parts.slice(0, -1).join(", ");
  return COMPOSER_COPY.needed(parts.length === 1 ? last : `${rest} and ${last}`);
}
/**
 * The introduction composer: the eligible partner the introduction happened with, the three provenance facts only the
 * person recording it can state, and — once all four are usable — the family's own introduction form over exactly those
 * values. Refusals are anchored to the control that carries the refused field's own name.
 */
export function ReferralIntroductionComposer({ scope, expectedRevision, candidates, className }: ReferralIntroductionComposerProps): ReactElement {
  const headingId = useId();
  const [partnerId, setPartnerId] = useState("");
  const [provenance, setProvenance] = useState<ProvenanceValues>(NO_PROVENANCE);
  const setProvenanceField = useCallback((field: keyof ProvenanceValues, value: string): void => {
    setProvenance((current) => (current[field] === value ? current : { ...current, [field]: value }));
  }, []);
  const partners = candidates.state === "available" ? candidates.partners : NO_PARTNERS;
  const selected = partners.find((candidate) => candidate.partnerId === partnerId);
  // The schema is the allow-list: the values handed to the form are its own output, so a pair or a zone it refuses never
  // reaches the record and a value it accepts travels exactly as it validated.
  const referenceParsed = sourceReferenceSchema.safeParse({ system: provenance.system, reference: provenance.reference });
  const zoneParsed = sourceZoneSchema.safeParse(provenance.sourceZone);
  const referenceMessages = referenceRefusalMessages(referenceParsed);
  const zoneMessage = zoneParsed.success ? undefined : zoneParsed.error.issues[0]?.message;
  // A control states its own schema message once something was typed into it and refused; an empty required value is
  // reported by the one sentence below instead, so the surface never opens on a column of errors before it was used.
  const systemMessage = provenance.system === "" ? undefined : referenceMessages[SYSTEM_PAIR_FIELD];
  const referenceMessage = provenance.reference === "" ? undefined : referenceMessages[REFERENCE_PAIR_FIELD];
  const zoneFieldMessage = provenance.sourceZone === "" ? undefined : zoneMessage;
  const needed: string[] = [];
  if (selected === undefined) {
    needed.push(COMPOSER_COPY.partnerPart);
  }
  if (referenceMessages[SYSTEM_PAIR_FIELD] !== undefined) {
    needed.push(COMPOSER_COPY.systemPart);
  }
  if (referenceMessages[REFERENCE_PAIR_FIELD] !== undefined) {
    needed.push(COMPOSER_COPY.referencePart);
  }
  if (zoneMessage !== undefined) {
    needed.push(COMPOSER_COPY.zonePart);
  }
  const neededSentence = stillNeededSentence(needed);
  return (
    <section id={COMPOSER_SECTION_ID} aria-labelledby={headingId} data-slot="referral-introduction-composer" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={headingId} className="font-heading text-xl font-semibold text-pretty wrap-anywhere">
          {COMPOSER_COPY.heading}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{COMPOSER_COPY.help}</p>
      </div>
      {candidates.state === "unavailable" ? (
        // The source did not answer, so no partner is offered: an empty picker would read as "nobody is eligible", which
        // is a statement about the roster this read never made.
        <StateNotice kind="unavailable" title={COMPOSER_COPY.unavailableTitle} description={COMPOSER_COPY.unavailableBody} source={candidates.source} headingLevel={3} />
      ) : partners.length === 0 ? (
        <StateNotice kind="empty" title={COMPOSER_COPY.noPartnerTitle} description={COMPOSER_COPY.noPartnerBody} headingLevel={3} />
      ) : (
        <>
          <FormField name={PARTNER_FIELD} label={COMPOSER_COPY.partnerLabel} required>
            {(control) => (
              <NativeSelect
                id={control.id}
                value={partnerId}
                aria-describedby={control.describedBy}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  setPartnerId(event.currentTarget.value);
                }}
                className="w-full sm:max-w-96"
              >
                <NativeSelectOption value="" disabled>
                  {COMPOSER_COPY.partnerPlaceholder}
                </NativeSelectOption>
                {partners.map((candidate) => (
                  <NativeSelectOption key={candidate.partnerId} value={candidate.partnerId}>
                    {candidate.displayName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField name={SOURCE_SYSTEM_FIELD} label={COMPOSER_COPY.systemLabel} description={COMPOSER_COPY.systemHelp} error={systemMessage} required>
            {(control) => (
              <Input
                id={control.id}
                value={provenance.system}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  setProvenanceField("system", event.currentTarget.value);
                }}
                className="w-full sm:max-w-96"
              />
            )}
          </FormField>
          <FormField name={SOURCE_REFERENCE_FIELD} label={COMPOSER_COPY.referenceLabel} description={COMPOSER_COPY.referenceHelp} error={referenceMessage} required>
            {(control) => (
              <Input
                id={control.id}
                value={provenance.reference}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  setProvenanceField("reference", event.currentTarget.value);
                }}
                className="w-full sm:max-w-96"
              />
            )}
          </FormField>
          <FormField name={SOURCE_ZONE_FIELD} label={COMPOSER_COPY.zoneLabel} description={COMPOSER_COPY.zoneHelp} error={zoneFieldMessage} required>
            {(control) => (
              <Input
                id={control.id}
                value={provenance.sourceZone}
                aria-describedby={control.describedBy}
                aria-invalid={control.invalid ? true : undefined}
                aria-required={control.required ? true : undefined}
                onChange={(event) => {
                  setProvenanceField("sourceZone", event.currentTarget.value);
                }}
                className="w-full sm:max-w-60"
              />
            )}
          </FormField>
          {selected === undefined || !referenceParsed.success || !zoneParsed.success ? (
            <p className="max-w-prose text-sm text-muted-foreground text-pretty wrap-anywhere">{neededSentence}</p>
          ) : (
            /**
             * The form's own review and receipt belong to the partner it records, so a different partner starts a fresh
             * form rather than inheriting an answer recorded about someone else. Neither `onRecorded` nor
             * `recordedAtDisplay` is passed: no record exists yet, and `useRecordIntroduction` already invalidates the
             * family's reads once a change settles.
             */
            <ReferralIntroductionForm key={selected.partnerId} scope={scope} partnerId={selected.partnerId} expectedRevision={expectedRevision} sourceReference={referenceParsed.data} sourceZone={zoneParsed.data} />
          )}
        </>
      )}
    </section>
  );
}
export default ReferralIntroductionComposer;
