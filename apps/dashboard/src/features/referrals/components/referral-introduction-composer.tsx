"use client";
/** The referral introduction composer: the one surface that records an original introduction, and the only composition of the family's introduction form. `ReferralIntroductionForm` asks only for the date the introduction happened and the precision it is known to, because every other part of its payload is a fact a record holds — the partner the introduction refers to, the revision the view read, and the provenance. Those are supplied here, and none is invented: a default system name, a generated reference or a zone taken from a display preference would each be a claim the record makes and no source asserts. The form appears only once all four values parse, so this surface states what is still needed rather than offering a submission the service would refuse. */
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
const COMPOSER_SECTION_ID = "record-introduction";
/** The address of this composer's own section, stated once so the control a surface offers and the section it lands on cannot drift apart. */
export const INTRODUCTION_COMPOSER_ANCHOR = `#${COMPOSER_SECTION_ID}`;
const PARTNER_FIELD = "partnerId"; // The field names a refusal is anchored to are the payload's own paths, so a provenance refusal lands on the control that states the value rather than on the form.
/** One partner the composing route offers for selection, and the candidate read it supplies: the eligible partners themselves, or the reason it could not enumerate them. */
export type ReferralIntroductionCandidate = { readonly partnerId: string; readonly displayName: string };
export type ReferralIntroductionCandidates = { readonly state: "available"; readonly partners: readonly ReferralIntroductionCandidate[] } | { readonly state: "unavailable"; readonly source: SourceReference };
export type ReferralIntroductionComposerProps = { readonly scope: Scope; readonly expectedRevision: string; readonly candidates: ReferralIntroductionCandidates; readonly className?: string };
/** Where each part of the record's provenance is stated, so the controls and the gated form read from one shape. */
type ProvenanceValues = { readonly system: string; readonly reference: string; readonly sourceZone: string };
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
const PROVENANCE_FIELDS = [
  { key: "system", path: "sourceReference.system", label: COMPOSER_COPY.systemLabel, help: COMPOSER_COPY.systemHelp, width: "sm:max-w-96", part: COMPOSER_COPY.systemPart },
  { key: "reference", path: "sourceReference.reference", label: COMPOSER_COPY.referenceLabel, help: COMPOSER_COPY.referenceHelp, width: "sm:max-w-96", part: COMPOSER_COPY.referencePart },
  { key: "sourceZone", path: "sourceZone", label: COMPOSER_COPY.zoneLabel, help: COMPOSER_COPY.zoneHelp, width: "sm:max-w-60", part: COMPOSER_COPY.zonePart },
] as const;
/** The messages a reference pair's refusal states, keyed by the field each one is about, in the schema's own words. */
function referenceRefusalMessages(parsed: ReturnType<typeof sourceReferenceSchema.safeParse>): Readonly<Record<string, string | undefined>> {
  if (parsed.success) return {};
  const messages: Record<string, string | undefined> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path.map(String).join(".");
    if (messages[field] === undefined) messages[field] = issue.message;
  }
  return messages;
}
/** The parts the record still needs, as one sentence in the order the controls are read. */
function stillNeededSentence(parts: readonly string[]): string | null {
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1] ?? "";
  return COMPOSER_COPY.needed(parts.length === 1 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`);
}
/** The introduction composer: the eligible partner the introduction happened with, the three provenance facts only the person recording it can state, and — once all four are usable — the family's own introduction form over exactly those values. */
export function ReferralIntroductionComposer({ scope, expectedRevision, candidates, className }: ReferralIntroductionComposerProps): ReactElement {
  const headingId = useId();
  const [partnerId, setPartnerId] = useState("");
  const [provenance, setProvenance] = useState<ProvenanceValues>(NO_PROVENANCE);
  const setProvenanceField = useCallback((field: keyof ProvenanceValues, value: string): void => setProvenance((current) => (current[field] === value ? current : { ...current, [field]: value })), []);
  const partners = candidates.state === "available" ? candidates.partners : NO_PARTNERS;
  const selected = partners.find((candidate) => candidate.partnerId === partnerId);
  const referenceParsed = sourceReferenceSchema.safeParse({ system: provenance.system, reference: provenance.reference }); // The schema is the allow-list: the values handed to the form are its own output, so a pair or a zone it refuses never reaches the record and a value it accepts travels exactly as it validated.
  const zoneParsed = sourceZoneSchema.safeParse(provenance.sourceZone);
  const referenceMessages = referenceRefusalMessages(referenceParsed);
  const zoneMessage = zoneParsed.success ? undefined : zoneParsed.error.issues[0]?.message;
  // A control states its own schema message once something was typed into it and refused; an empty required value is reported by the one sentence below instead, so the surface never opens on a column of errors.
  const messageOf = (key: keyof ProvenanceValues): string | undefined => (provenance[key] === "" ? undefined : key === "sourceZone" ? zoneMessage : referenceMessages[key]);
  const needed: string[] = [];
  if (selected === undefined) needed.push(COMPOSER_COPY.partnerPart);
  for (const entry of PROVENANCE_FIELDS) if (messageOf(entry.key) !== undefined) needed.push(entry.part);
  return (
    <section id={COMPOSER_SECTION_ID} aria-labelledby={headingId} data-slot="referral-introduction-composer" className={cn("flex min-w-0 flex-col gap-6", className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 {...{ id: headingId, className: "type-section-title text-pretty wrap-anywhere" }}>{COMPOSER_COPY.heading}</h2>
        <p className="type-supporting max-w-prose text-pretty wrap-anywhere">{COMPOSER_COPY.help}</p>
      </div>
      {candidates.state === "unavailable" ? (
        // The source did not answer, so no partner is offered: an empty picker would read as "nobody is eligible", which is a statement about the roster this read never made.
        <StateNotice kind="unavailable" title={COMPOSER_COPY.unavailableTitle} description={COMPOSER_COPY.unavailableBody} source={candidates.source} headingLevel={3} />
      ) : partners.length === 0 ? (
        <StateNotice kind="empty" title={COMPOSER_COPY.noPartnerTitle} description={COMPOSER_COPY.noPartnerBody} headingLevel={3} />
      ) : (
        <>
          <FormField name={PARTNER_FIELD} label={COMPOSER_COPY.partnerLabel} required>
            {(control) => (
              <NativeSelect id={control.id} value={partnerId} aria-describedby={control.describedBy} aria-required={control.required ? true : undefined} onChange={(event) => setPartnerId(event.currentTarget.value)} className="w-full sm:max-w-96">
                <NativeSelectOption {...{ value: "", disabled: true }}>{COMPOSER_COPY.partnerPlaceholder}</NativeSelectOption>
                {partners.map((candidate) => (
                  <NativeSelectOption key={candidate.partnerId} value={candidate.partnerId}>
                    {candidate.displayName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {PROVENANCE_FIELDS.map((entry) => (
            <FormField key={entry.key} name={entry.path} label={entry.label} description={entry.help} error={messageOf(entry.key)} required>
              {(control) => (
                <Input
                  id={control.id}
                  value={provenance[entry.key]}
                  aria-describedby={control.describedBy}
                  aria-invalid={control.invalid ? true : undefined}
                  aria-required={control.required ? true : undefined}
                  onChange={(event) => setProvenanceField(entry.key, event.currentTarget.value)}
                  className={cn("w-full", entry.width)}
                />
              )}
            </FormField>
          ))}
          {selected === undefined || !referenceParsed.success || !zoneParsed.success ? (
            <p className="type-supporting max-w-prose text-pretty wrap-anywhere">{stillNeededSentence(needed)}</p>
          ) : (
            // The form's own review and receipt belong to the partner it records, so a different partner starts a fresh form rather than inheriting an answer recorded about someone else.
            <ReferralIntroductionForm key={selected.partnerId} scope={scope} partnerId={selected.partnerId} expectedRevision={expectedRevision} sourceReference={referenceParsed.data} sourceZone={zoneParsed.data} />
          )}
        </>
      )}
    </section>
  );
}
export default ReferralIntroductionComposer;
