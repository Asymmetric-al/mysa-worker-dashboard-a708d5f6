"use client";

/**
 * The duration field of a coaching invitation, and the cutoff a grant actually ended up with.
 *
 * Two duration kinds exist and no third one does: `ongoing` (sharing has no end date until the
 * relationship ends or the worker revokes it) and `through-date` (sharing closes at the cutoff the
 * chosen Share-through date produces). The worker picks one; nothing is pre-selected, because a
 * default duration would be permission nobody gave, and a missing duration is invalid rather than
 * permission — the invitation form's schema refuses it, and this control states the same refusal
 * before it happens rather than discovering it after a submit.
 *
 * The cutoff is displayed and never derived here. The exclusive start of the civil day after the
 * Share-through date is resolved once, by the time module's window functions behind the service, and
 * arrives in the read envelope as a string with the zone it was resolved in; it is frozen at
 * acceptance, so travelling, changing a display time zone or a later source change cannot move it.
 * This file therefore constructs no date-time instant of its own, reads no clock, converts no civil
 * date to an instant and compares no cutoff against the present moment — a local recomputation would
 * defeat the freeze it is meant to report. What it does render, verbatim, is the value the envelope
 * handed in.
 *
 * Three distinctions the rendering must keep visible:
 *
 * - `ongoing` and `through-date` are different ends, so each names what it does to access in its own
 *   sentence rather than sharing one "ends at some point" phrasing.
 * - The chosen duration is a maximum, not a guarantee: an earlier limit set by the source can end
 *   access sooner, and that limit is disclosed whenever it is the value in force, never silently
 *   preferred over the one the worker chose.
 * - An accepted grant's cutoff is fixed, and a not-yet-accepted invitation has none at all: the
 *   surface says the cutoff will be fixed at acceptance and shows no provisional value, because a
 *   provisional number would not be the value governing access.
 *
 * Rule 1 clause 2 composition: the choices are the installed `RadioGroup` inside the shared
 * `FormFieldGroup`, the date is the installed `Input` with a date type (no date-picker dependency),
 * the cutoff is the design system's `Card`, `Badge`, `Alert` and `Separator`, and every form error is
 * the shared `FormField` presentation. No colour, radius or spacing literal is stated here, and the
 * spacing utilities used are logical.
 *
 * The duration's own words live in this file's `DURATION_WORDING` rather than in the family's
 * `copy.ts`: that module words the domain's state and surface unions, and neither union has a member
 * for a duration kind or for a cutoff, so nothing there names these two choices. Declaring them once,
 * here and exported, keeps a single source for them instead of a second copy in the form that hosts
 * the control.
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

/**
 * The two duration kinds, in reading order. Declared as a tuple so the set also has a runtime form:
 * the group renders it, {@link isDurationKind} narrows against it, and a third kind would have to be
 * added here and worded below before it could render.
 */
export const DURATION_KINDS = ["ongoing", "through-date"] as const;

/** How long sharing runs: no end date, or through a calendar date the worker chooses. */
export type DurationKind = (typeof DURATION_KINDS)[number];

/**
 * The duration a worker has chosen, or `null` for not chosen yet.
 *
 * `throughDate` is a {@link CivilDate} — a calendar date with no zone and no time of day — and it is
 * `null` while the worker has picked `through-date` but not yet named the date. Converting it to a
 * midnight, or to the cutoff, happens behind the service; this value never holds an instant.
 */
export type DurationValue =
  | { readonly kind: "ongoing" }
  | { readonly kind: "through-date"; readonly throughDate: CivilDate | null };

/**
 * The cutoff a grant is actually governed by, exactly as the read envelope reports it.
 *
 * `instant` and `zone` are the frozen values and are rendered verbatim. `sourceLimitWins` says an
 * earlier limit set by the source is the value in force, and `sourceLimit` carries that limit's own
 * wording when the source supplied it; a source limit whose value cannot be read is stated as such
 * rather than shown as an empty or substituted one.
 */
export interface FrozenDurationCutoff {
  /** The exclusive instant access stops, as the envelope resolved it. Never recomputed here. */
  readonly instant: string;
  /** The zone the cutoff was resolved in, as a zone identifier the source accepted. */
  readonly zone: string;
  /** Whether an earlier limit set by the source is the value in force. */
  readonly sourceLimitWins: boolean;
  /** That earlier limit's own wording, when the source supplied one. */
  readonly sourceLimit?: string | null;
}

/** Props of {@link DurationControl}. */
export interface DurationControlProps {
  /** The chosen duration, or `null` while nothing is chosen. Never defaulted by this control. */
  readonly value: DurationValue | null;
  /** Reports a new choice, or `null`-carrying loss of one, to the form that owns the value. */
  readonly onChange: (next: DurationValue | null) => void;
  /** The invitation schema's message for the duration field. Rendered as given, never reworded. */
  readonly error?: string | null;
  /** The frozen cutoff for an accepted grant. Absent until then, and then nothing is shown. */
  readonly frozenCutoff?: FrozenDurationCutoff | null;
  /** When set, every control is disabled and this is the visible, associated reason. */
  readonly disabledReason?: string | null;
  /** The worker's locale; passed to the date control so its own date fields follow it. */
  readonly locale: string;
}

/** Wording for one duration kind: the label a reader picks, and what choosing it does to access. */
export interface DurationKindWording {
  readonly label: string;
  readonly description: string;
}

/**
 * Every word this control renders, in one shape.
 *
 * Exported so the invitation form's review step and the surface's tests read the same strings the
 * control renders instead of restating them. The two sentences that must never be lost are
 * `missingIsNotPermission` (a missing duration is invalid, not consent to share) and `chosenIsAMaximum`
 * (an earlier source limit can shorten the chosen duration, so it is a ceiling and not a promise).
 */
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
  fieldLead:
    "A duration is required. Modules start switched off, and nothing is readable by a coach until " +
    "the person accepts, so the choice below sets the most this invitation can ever cover.",
  missingIsNotPermission:
    "No duration is chosen yet, and a missing duration is not permission to share: the invitation " +
    "cannot be submitted until one is chosen.",
  dateLabel: "Share through",
  dateDescription:
    "The last calendar date sharing should cover. It is a date as you would say it, with no time " +
    "of day recorded, and the cutoff it produces is the start of the following day.",
  dateRequired: "Choose the Share-through date.",
  dateRefused:
    "This value could not be read as a calendar date in the form YYYY-MM-DD, so no date was " +
    "recorded for it. The field is empty again: choose the date once more.",
  cutoffHeading: "When sharing ends",
  cutoffFixedBadge: "Cutoff fixed on acceptance",
  cutoffNotFixedBadge: "No cutoff yet",
  cutoffInstantLabel: "Share cutoff",
  cutoffZoneLabel: "Zone the cutoff was resolved in",
  cutoffExclusive:
    "The cutoff is the exclusive start of the civil day after the Share-through date: a read at " +
    "that instant is refused, so the last day sharing covers is the day before it.",
  cutoffFrozenAtAcceptance:
    "This value was fixed when the invitation was accepted. Travelling, changing your display time " +
    "zone or a later change to the source cannot move it.",
  chosenIsAMaximum:
    "The duration you chose is a maximum and not a guarantee: an earlier limit set by the source " +
    "can end access sooner, and you can revoke access before the cutoff.",
  cutoffNotFixed:
    "The cutoff is fixed when the invitation is accepted. Until then this surface states the rule " +
    "rather than a value.",
  cutoffNotProvisional:
    "No provisional cutoff is shown, because a provisional number would not be the one that governs " +
    "access.",
  sourceLimitTitle: "An earlier limit from the source applies",
  sourceLimitWins:
    "A limit set by the source ends access before the date this invitation chose, and the earlier " +
    "limit wins: the cutoff shown above is the source's, not the one chosen here.",
  sourceLimitUnknown:
    "A limit set by the source ends access before the date this invitation chose, and the earlier " +
    "limit wins. Its own value cannot be read right now, so nothing is put in its place.",
  kinds: {
    ongoing: {
      label: "Ongoing, until you end it",
      description:
        "Sharing has no end date. It stays open until you revoke it or the coaching relationship " +
        "ends, whichever comes first.",
    },
    "through-date": {
      label: "Through a date you choose",
      description:
        "Sharing closes at the cutoff that date produces. Choose the last calendar date it should " +
        "cover; the cutoff is stated once the invitation is accepted.",
    },
  },
};

/** Whether a radio group's value is one of the two duration kinds, with no cast. */
function isDurationKind(value: unknown): value is DurationKind {
  return value === "ongoing" || value === "through-date";
}

/** A reason counts as given only when it says something; a blank one is no reason at all. */
function statedReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) {
    return null;
  }
  return reason.trim() === "" ? null : reason;
}

/**
 * The duration field of a coaching invitation: `ongoing` or `through-date`, plus the frozen cutoff a
 * grant was given. The cutoff is displayed from the envelope and never derived here.
 */
export default function DurationControl({
  value,
  onChange,
  error = null,
  frozenCutoff = null,
  disabledReason = null,
  locale,
}: DurationControlProps): ReactElement {
  const idPrefix = useId();
  const [refusedDateText, setRefusedDateText] = useState<string | null>(null);

  const reason = statedReason(disabledReason);
  const disabled = reason !== null;
  const kind = value?.kind ?? null;
  const throughDate = value?.kind === "through-date" ? value.throughDate : null;
  const civilDateText = throughDate === null ? "" : serialiseCivilDate(throughDate);

  /* Switching between the two kinds drops any date the other kind held: the date belongs to
   * `through-date` only, and carrying it across would put a value in the form that the chosen kind
   * says nothing about. Re-selecting the kind already chosen is not a change and reports nothing, so
   * an arrow key pressed on the selected radio cannot wipe a date the worker just typed. */
  const chooseKind = (next: unknown): void => {
    if (disabled || !isDurationKind(next) || next === kind) {
      return;
    }
    setRefusedDateText(null);
    onChange(
      next === "ongoing" ? { kind: "ongoing" } : { kind: "through-date", throughDate: null },
    );
  };

  /* The date control's own value is a `YYYY-MM-DD` string, which is exactly the storage form a civil
   * date has: parsing it keeps the day civil (no midnight is invented) and a refusal is reported as a
   * message rather than thrown. An empty control means no date chosen yet, which is `null` — never
   * today's date and never an epoch. */
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

  /* The group's own description carries the refusal fact while nothing is chosen, and the schema's
   * message stays the only error: one message source per field, and the state the reader is in is
   * described before they act rather than after they are refused. A disabled group states its reason
   * instead, so no control is ever inert without a stated cause. */
  const groupDescription =
    reason ??
    (kind === null
      ? `${DURATION_WORDING.fieldLead} ${DURATION_WORDING.missingIsNotPermission}`
      : DURATION_WORDING.fieldLead);

  /* An empty Share-through date is a date still to choose, so the field says so in its description;
   * the parser's refusal is the only thing this control raises as its own message. */
  const dateDescription =
    reason ??
    (throughDate === null
      ? `${DURATION_WORDING.dateDescription} ${DURATION_WORDING.dateRequired}`
      : DURATION_WORDING.dateDescription);

  return (
    <div data-slot="duration-control" className="flex min-w-0 flex-col gap-6">
      <FormFieldGroup
        legend={DURATION_WORDING.legend}
        name="duration"
        description={groupDescription}
        error={error ?? undefined}
        required
      >
        {({ describedBy, invalid, required, legendId }) => (
          <RadioGroup
            value={kind}
            onValueChange={chooseKind}
            disabled={disabled}
            aria-labelledby={legendId}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-required={required}
          >
            {DURATION_KINDS.map((option) => {
              const wording = DURATION_WORDING.kinds[option];
              const optionId = `${idPrefix}-duration-${option}`;
              const optionDescriptionId = `${optionId}-description`;
              return (
                /* The label wraps its radio and names it, so the whole row is a pointer target of at
                 * least the 24x24 CSS px floor and the accessible name is the visible label. The
                 * option's explanation is associated by `aria-describedby`, so a reader hears what the
                 * choice does to access without the group repeating it once per option. */
                <label
                  key={option}
                  htmlFor={optionId}
                  className="flex min-h-target items-start gap-3 py-1"
                >
                  <RadioGroupItem
                    id={optionId}
                    value={option}
                    aria-label={wording.label}
                    aria-describedby={optionDescriptionId}
                    className="mt-0.5"
                  />
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
        <FormField
          label={DURATION_WORDING.dateLabel}
          name="duration.throughDate"
          description={dateDescription}
          error={refusedDateText ?? undefined}
          required
        >
          {(field) => (
            /* A date `Input` rather than a calendar widget: the value is a civil date, the browser's
             * own date control needs no dependency, and `lang` lets its field order and month names
             * follow the worker's locale while the value stays a plain `YYYY-MM-DD`. It keeps full
             * width at 320 CSS px and stops growing once there is room beside it. */
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

/**
 * What governs the end of sharing, as the envelope reports it: the frozen cutoff for a grant that has
 * been accepted, or the plain statement that there is not one yet.
 *
 * Presentation only, and the two states never share a rendering. A frozen cutoff shows the instant
 * and the zone exactly as they arrived — inside `<bdi>`, because an instant mixes digits, a separator
 * and a zone name, and an unisolated string like that can reorder its neighbours in right-to-left
 * text — together with the two disclosures that keep it honest: it is the exclusive start of the day
 * after the Share-through date, and it was fixed at acceptance. A grant with no cutoff shows no value
 * at all: it says the cutoff is fixed on acceptance, and that no provisional one is displayed.
 *
 * An earlier limit set by the source is disclosed as the value in force whenever it wins, and its own
 * wording is shown when the source supplied it. Nothing here recomputes, compares or converts a
 * cutoff, and nothing presents the duration as permission the cutoff grants rather than a ceiling on
 * what access can cover.
 */
function DurationCutoffPanel({
  frozenCutoff,
}: {
  readonly frozenCutoff: FrozenDurationCutoff | null;
}): ReactElement {
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
                <p>
                  {sourceLimit === null
                    ? DURATION_WORDING.sourceLimitUnknown
                    : DURATION_WORDING.sourceLimitWins}
                </p>
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
