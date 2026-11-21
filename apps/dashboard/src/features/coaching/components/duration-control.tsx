"use client";
/**
 * The duration field of a coaching invitation, and the cutoff a grant actually ended up with.
 */
import { useId, useState, type ReactElement } from "react";
import { FormField, FormFieldGroup } from "@/components/form-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { parseCivilDate, serialiseCivilDate, type CivilDate } from "@/modules/time/civil";
/** The two duration kinds, in reading order. */
export const DURATION_KINDS = ["ongoing", "through-date"] as const;
/** How long sharing runs: no end date, or through a calendar date the worker chooses. */
export type DurationKind = (typeof DURATION_KINDS)[number];
/** The duration a worker has chosen, or `null` for not chosen yet. */
export type DurationValue = { readonly kind: "ongoing" } | { readonly kind: "through-date"; readonly throughDate: CivilDate | null };
/** The cutoff a grant is actually governed by, exactly as the read envelope reports it. */
export interface FrozenDurationCutoff {
  readonly instant: string;
  readonly zone: string;
  readonly sourceLimitWins: boolean;
  readonly sourceLimit?: string | null;
}
/** Props of {@link DurationControl}. */
export interface DurationControlProps {
  readonly value: DurationValue | null;
  readonly onChange: (next: DurationValue | null) => void;
  readonly error?: string | null;
  readonly frozenCutoff?: FrozenDurationCutoff | null;
  readonly disabledReason?: string | null;
  readonly locale: string;
}
/** Wording for one duration kind: the label a reader picks, and what choosing it does to access. */
export interface DurationKindWording {
  readonly label: string;
  readonly description: string;
}
/** Every word this control renders, in one shape. */
export interface DurationWording {
  readonly legend: string;
  readonly fieldLead: string;
  readonly missingIsNotPermission: string;
  readonly dateLabel: string;
  readonly dateDescription: string;
  readonly dateRequired: string;
  readonly dateRefused: string;
  readonly cutoffHeading: string;
  readonly cutoffFixedBadge: string;
  readonly cutoffNotFixedBadge: string;
  readonly cutoffInstantLabel: string;
  readonly cutoffZoneLabel: string;
  readonly cutoffExclusive: string;
  readonly cutoffFrozenAtAcceptance: string;
  readonly chosenIsAMaximum: string;
  readonly cutoffNotFixed: string;
  readonly cutoffNotProvisional: string;
  readonly sourceLimitTitle: string;
  readonly sourceLimitWins: string;
  readonly sourceLimitUnknown: string;
  readonly kinds: Readonly<Record<DurationKind, DurationKindWording>>;
}
/** The duration control's words: the two kinds, the refusal facts, and the cutoff disclosures. */
export const DURATION_WORDING: DurationWording = {
  legend: "How long sharing runs",
  fieldLead: "A duration is required. Modules start switched off, and nothing is readable by a coach until " + "the person accepts, so the choice below sets the most this invitation can ever cover.",
  missingIsNotPermission: "No duration is chosen yet, and a missing duration is not permission to share: the invitation " + "cannot be submitted until one is chosen.",
  dateLabel: "Share through",
  dateDescription: "The last calendar date sharing should cover. It is a date as you would say it, with no time " + "of day recorded, and the cutoff it produces is the start of the following day.",
  dateRequired: "Choose the Share-through date.",
  dateRefused: "This value could not be read as a calendar date in the form YYYY-MM-DD, so no date was " + "recorded for it. The field is empty again: choose the date once more.",
  cutoffHeading: "When sharing ends",
  cutoffFixedBadge: "Cutoff fixed on acceptance",
  cutoffNotFixedBadge: "No cutoff yet",
  cutoffInstantLabel: "Share cutoff",
  cutoffZoneLabel: "Zone the cutoff was resolved in",
  cutoffExclusive: "The cutoff is the exclusive start of the civil day after the Share-through date: a read at " + "that instant is refused, so the last day sharing covers is the day before it.",
  cutoffFrozenAtAcceptance: "This value was fixed when the invitation was accepted. Travelling, changing your display time " + "zone or a later change to the source cannot move it.",
  chosenIsAMaximum: "The duration you chose is a maximum and not a guarantee: an earlier limit set by the source " + "can end access sooner, and you can revoke access before the cutoff.",
  cutoffNotFixed: "The cutoff is fixed when the invitation is accepted. Until then this surface states the rule " + "rather than a value.",
  cutoffNotProvisional: "No provisional cutoff is shown, because a provisional number would not be the one that governs " + "access.",
  sourceLimitTitle: "An earlier limit from the source applies",
  sourceLimitWins: "A limit set by the source ends access before the date this invitation chose, and the earlier " + "limit wins: the cutoff shown above is the source's, not the one chosen here.",
  sourceLimitUnknown:
    "A limit set by the source ends access before the date this invitation chose, and the earlier " + "limit wins. Its own value cannot be read right now, so nothing is put in its place.",
  kinds: {
    ongoing: {
      label: "Ongoing, until you end it",
      description: "Sharing has no end date. It stays open until you revoke it or the coaching relationship " + "ends, whichever comes first.",
    },
    "through-date": {
      label: "Through a date you choose",
      description: "Sharing closes at the cutoff that date produces. Choose the last calendar date it should " + "cover; the cutoff is stated once the invitation is accepted.",
    },
  },
};
function isDurationKind(value: unknown): value is DurationKind {
  return value === "ongoing" || value === "through-date";
}
function statedReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) {
    return null;
  }
  return reason.trim() === "" ? null : reason;
}
/** The duration field of a coaching invitation: `ongoing` or `through-date`, plus the frozen cutoff a grant was given. */
export default function DurationControl({ value, onChange, error = null, frozenCutoff = null, disabledReason = null, locale }: DurationControlProps): ReactElement {
  const idPrefix = useId();
  const [refusedDateText, setRefusedDateText] = useState<string | null>(null);
  const reason = statedReason(disabledReason);
  const disabled = reason !== null;
  const kind = value?.kind ?? null;
  const throughDate = value?.kind === "through-date" ? value.throughDate : null;
  const civilDateText = throughDate === null ? "" : serialiseCivilDate(throughDate);
  const chooseKind = (next: unknown): void => {
    if (disabled || !isDurationKind(next) || next === kind) {
      return;
    }
    setRefusedDateText(null);
    onChange(next === "ongoing" ? { kind: "ongoing" } : { kind: "through-date", throughDate: null });
  };
  const changeDate = (nextText: string): void => {
    if (disabled) {
      return;
    }
    if (nextText === "") {
      setRefusedDateText(null);
      onChange({ kind: "through-date", throughDate: null });
      return;
    }
    const parsed = parseCivilDate(nextText);
    if (parsed.status === "parsed") {
      setRefusedDateText(null);
      onChange({ kind: "through-date", throughDate: parsed.date });
      return;
    }
    setRefusedDateText(DURATION_WORDING.dateRefused);
    onChange({ kind: "through-date", throughDate: null });
  };
  const groupDescription = reason ?? (kind === null ? `${DURATION_WORDING.fieldLead} ${DURATION_WORDING.missingIsNotPermission}` : DURATION_WORDING.fieldLead);
  const dateDescription = reason ?? (throughDate === null ? `${DURATION_WORDING.dateDescription} ${DURATION_WORDING.dateRequired}` : DURATION_WORDING.dateDescription);
  return (
    <div data-slot="duration-control" className="flex min-w-0 flex-col gap-6">
      <FormFieldGroup legend={DURATION_WORDING.legend} name="duration" description={groupDescription} error={error ?? undefined} required>
        {({ describedBy, invalid, required, legendId }) => (
          <RadioGroup value={kind} onValueChange={chooseKind} disabled={disabled} aria-labelledby={legendId} aria-describedby={describedBy} aria-invalid={invalid} aria-required={required}>
            {DURATION_KINDS.map((option) => {
              const wording = DURATION_WORDING.kinds[option];
              const optionId = `${idPrefix}-duration-${option}`;
              const optionDescriptionId = `${optionId}-description`;
              return (
                <label key={option} htmlFor={optionId} className="flex min-h-target items-start gap-3 py-1">
                  <RadioGroupItem id={optionId} value={option} aria-label={wording.label} aria-describedby={optionDescriptionId} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{wording.label}</span>
                    <span id={optionDescriptionId} className="text-sm text-muted-foreground">
                      {wording.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </RadioGroup>
        )}
      </FormFieldGroup>
      {kind === "through-date" ? (
        <FormField label={DURATION_WORDING.dateLabel} name="duration.throughDate" description={dateDescription} error={refusedDateText ?? undefined} required>
          {(field) => (
            <Input
              id={field.id}
              type="date"
              lang={locale}
              value={civilDateText}
              disabled={disabled}
              aria-describedby={field.describedBy}
              aria-invalid={field.invalid}
              aria-required={field.required}
              onChange={(event) => {
                changeDate(event.currentTarget.value);
              }}
              className="w-full sm:max-w-60"
            />
          )}
        </FormField>
      ) : null}
      <DurationCutoffPanel frozenCutoff={frozenCutoff} />
    </div>
  );
}
function DurationCutoffPanel({ frozenCutoff }: { readonly frozenCutoff: FrozenDurationCutoff | null }): ReactElement {
  if (frozenCutoff === null) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h3 className="font-heading text-base font-medium">{DURATION_WORDING.cutoffHeading}</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-3">
          <div>
            <Badge variant="outline">{DURATION_WORDING.cutoffNotFixedBadge}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{DURATION_WORDING.cutoffNotFixed}</p>
          <p className="text-sm text-muted-foreground">{DURATION_WORDING.cutoffNotProvisional}</p>
        </CardContent>
      </Card>
    );
  }
  const sourceLimit = statedReason(frozenCutoff.sourceLimit);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          <h3 className="font-heading text-base font-medium">{DURATION_WORDING.cutoffHeading}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <div>
          <Badge variant="secondary">{DURATION_WORDING.cutoffFixedBadge}</Badge>
        </div>
        <dl className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-sm font-medium">{DURATION_WORDING.cutoffInstantLabel}</dt>
            <dd className="tabular-figures text-sm wrap-anywhere">
              <bdi>{frozenCutoff.instant}</bdi>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-sm font-medium">{DURATION_WORDING.cutoffZoneLabel}</dt>
            <dd className="text-sm wrap-anywhere">
              <bdi>{frozenCutoff.zone}</bdi>
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">{DURATION_WORDING.cutoffExclusive}</p>
        <p className="text-sm text-muted-foreground">{DURATION_WORDING.cutoffFrozenAtAcceptance}</p>
        <p className="text-sm text-muted-foreground">{DURATION_WORDING.chosenIsAMaximum}</p>
        {frozenCutoff.sourceLimitWins ? (
          <>
            <Separator />
            {/* A static explanation, not an announcement: the surface's own live region reports the
             * result of a save, so this note must not speak a second time on every render. */}
            <Alert role={undefined}>
              <AlertTitle>{DURATION_WORDING.sourceLimitTitle}</AlertTitle>
              <AlertDescription>
                <p>{sourceLimit === null ? DURATION_WORDING.sourceLimitUnknown : DURATION_WORDING.sourceLimitWins}</p>
                {sourceLimit === null ? null : (
                  <p className="mt-1">
                    <bdi>{sourceLimit}</bdi>
                  </p>
                )}
              </AlertDescription>
            </Alert>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
