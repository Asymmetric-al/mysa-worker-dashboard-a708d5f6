"use client";
/**
 * The Partners family's one typeahead partner selector: a worker searches the roster the service reads and chooses a
 * record from it, and the choice is an opaque record reference beside the source system that owns it.
 *
 * Every match is the service's. The debounced term travels in the roster read's own `search` parameter, so the whole
 * authorised dataset is searched and nothing here filters, orders or compares a name, an address or an identifier:
 * two records that read alike stay two records, and a name is never a key. The control itself is the installed
 * combobox, the composition the architecture note records for searchable selection, so the popup, the list and its
 * keyboard belong to one implementation rather than to a second listbox beside it.
 *
 * What this control yields carries authority for nothing. It issues no mutation, asserts no permission, records no
 * interaction and sends no message: choosing a partner here states which record the worker means, and nothing more.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { queryKey } from "@/components/context-switch-guard";
import { FormField, refusalSummary, type FormFieldControl } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, ComboboxValue } from "@/components/ui/combobox";
import { cn } from "@/lib/cn";
import { formatSourceReference, sameSourceReference, type SourceReference } from "@/lib/ids";
import { PARTNER_KINDS, sameScope, type PartnerKind, type ReadEnvelope, type Scope } from "@/modules/data-service/envelope";
import { FACET_VALUE_LABELS } from "../copy/facets";
import { fetchPartnerRead, PARTNER_KEY, PartnerReadTransportError } from "../hooks/use-partner-mutations";
import { PARTNERS_READ_PATH, ROSTER_PAGE_SIZE_CAP, ROSTER_QUERY_PARAM, ROSTER_READ_JOB, rosterRequestParams, type RosterRequestParams } from "../hooks/use-roster-query";

// The words this control states, in one place, so no two renders word the same condition differently.
const PICKER_COPY = {
  searchPlaceholder: "Search partners by name",
  loading: "Reading the partner records this search matches",
  noMatch: "No partner record matches that search. Try fewer words, or a different spelling.",
  noRecords: "This roster holds no record this control can offer yet.",
  emptyTitle: "No partner record exists yet",
  emptyBody: "Nothing is on the roster to choose from, so the first useful step is bringing contacts in rather than picking one.",
  emptyAction: "Bring in contacts from a file",
  emptyHref: "/partners/import",
  deniedTitle: "Partner records are not available in this context",
  elsewhereTitle: "These partner records were read in another context",
  elsewhereBody: "The roster answered under a different organisation, ministry or support subject from the one this field is working in, so nothing from that answer is shown, counted or offered here.",
  deniedBody: "No partner read is admitted for the context selected here, so this control offers no record rather than an empty list.",
  unavailableTitle: "The partner records could not be read",
  unavailableBody: "The source behind the roster did not answer, so this control offers no record rather than an empty list or a count of zero.",
  refusedTitle: "That search could not be asked",
  retry: "Read the roster again",
  contextTitle: "Choose a context before choosing a partner",
  contextBody: "A partner read runs under one organisation, ministry and support subject, so this search waits until a context is selected.",
  excludeNote: "A record already chosen in another field is listed here but cannot be chosen again.",
  alreadyChosen: "already chosen",
  showingFirst: (shown: number, total: number): string => `Showing the first ${shown} of ${total} matching records. Refine the search to reach the rest.`,
} as const;

/** How long the worker's typing settles before the term is sent to the service, so a name is one read rather than one per key. */
const SEARCH_DEBOUNCE_MS = 250;

/** How many matches one picker read asks for: a bounded page rather than the whole dataset, within the roster's own cap. */
const PICKER_PAGE_SIZE = Math.min(20, ROSTER_PAGE_SIZE_CAP);

/** The page the picker reads: the request grammar states pages counted from one, and the read itself counts from zero. */
const PICKER_PAGE = 1;

/** The read's parameter names, as `GET /api/partners` parses them; the values come from the roster hook's own request grammar. */
const READ_PARAM = { search: "search", page: "page", pageSize: "pageSize" } as const;

/**
 * One partner the worker may choose: the opaque record reference the source owns, the source system that owns it, and
 * the two display facts this control renders beside it. The reference and the source are the identity; the name and
 * the kind are read-only presentation and are never compared, joined or used as a key.
 */
export interface PartnerSelection {
  readonly partnerId: string;
  readonly kind: PartnerKind;
  readonly displayName: string;
  readonly source: SourceReference;
}

/** The opaque, source-qualified reference this selection and the record it came from share: what `excludeRefs` is compared against. */
export function partnerSelectionRef(selection: PartnerSelection): string {
  return formatSourceReference({ system: selection.source.system, reference: selection.partnerId });
}

/** Whether two selections denote the same record in the same source, so a chosen value is recognised after a re-read. */
export function samePartnerSelection(left: PartnerSelection, right: PartnerSelection): boolean {
  return left.partnerId === right.partnerId && sameSourceReference(left.source, right.source);
}

/** What every mode of the picker needs from its caller. */
interface PartnerPickerCommonProps {
  /** The authority the roster is read under; a search is issued only once all four identifiers are stated. */
  readonly scope: Scope;
  /** The field's own label, wired to the search control by {@link FormField}. */
  readonly label: string;
  readonly description?: string;
  /** The messages a refused submit produced for this field, rendered through the one field-error presentation. */
  readonly error?: string | readonly string[];
  readonly disabled?: boolean;
  /** The field's name, which decides its control id; two pickers on one page state two names. */
  readonly name?: string;
  /** Opaque references of records already chosen elsewhere, which this control lists but refuses to choose again. */
  readonly excludeRefs?: readonly string[];
  /** Called with the record a worker has just chosen, so the deliberate-link step can review it before anything is written. */
  readonly onLinkIntended?: (selection: PartnerSelection) => void;
  /** The heading level the shared notices render at, so a notice inside a form section keeps the page's outline. */
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string;
}

/** Props of {@link PartnerPicker}: one record, or a list of them, stated as the two modes the combobox itself has. */
export type PartnerPickerProps = PartnerPickerCommonProps &
  (
    | { readonly mode: "single"; readonly value: PartnerSelection | null; readonly onValueChange: (value: PartnerSelection | null) => void }
    | { readonly mode: "multiple"; readonly value: readonly PartnerSelection[]; readonly onValueChange: (value: readonly PartnerSelection[]) => void }
  );

/** The members this control needs off one roster row: the record's opaque identity, its kind and the name the source gives it. */
interface RosterPartnerRow {
  readonly partnerId: string;
  readonly kind: PartnerKind;
  readonly displayName: string;
}

/** One page of matches, once its payload is the shape this read documents. */
interface PartnerPage {
  readonly options: readonly PartnerSelection[];
  readonly total: number;
}

/** Whether a value names one of the record kinds the roster admits, so a payload cannot smuggle in a kind this control has no label for. */
function isPartnerKind(value: string): value is PartnerKind {
  return PARTNER_KINDS.some((kind) => kind === value);
}

/** The kind of record in words, from the roster's own label set; an open value the service supplied is shown exactly as supplied. */
function kindLabelOf(kind: PartnerKind): string {
  return FACET_VALUE_LABELS["contact-type"][kind] ?? kind;
}

/** The one member of a roster row this control reads, or nothing when the row does not state the identity it must. */
function rowOf(row: unknown): RosterPartnerRow | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const partner: unknown = (row as { partner?: unknown }).partner;
  if (typeof partner !== "object" || partner === null) {
    return null;
  }
  const record = partner as { partnerId?: unknown; kind?: unknown; displayName?: unknown };
  const { partnerId, kind, displayName } = record;
  if (typeof partnerId !== "string" || partnerId === "") {
    return null;
  }
  if (typeof displayName !== "string" || displayName === "") {
    return null;
  }
  if (typeof kind !== "string" || !isPartnerKind(kind)) {
    return null;
  }
  return { partnerId, kind, displayName };
}

/**
 * The roster page a picker read answers with, checked rather than trusted: a payload of another shape is a fault of the
 * response boundary, so it reaches the query's error state as an outage instead of rendering as an empty list or a zero.
 */
function pageOf(data: unknown, url: string, source: SourceReference): PartnerPage {
  const payload = typeof data === "object" && data !== null ? (data as { rows?: unknown; total?: unknown }) : {};
  const { rows, total } = payload;
  if (!Array.isArray(rows) || typeof total !== "number" || !Number.isFinite(total)) {
    throw new PartnerReadTransportError(url, undefined, "a payload that is not the roster page this picker reads");
  }
  const options: PartnerSelection[] = [];
  for (const row of rows) {
    const stated = rowOf(row);
    if (stated === null) {
      throw new PartnerReadTransportError(url, undefined, "a roster row that states no partner identity");
    }
    options.push({ ...stated, source });
  }
  return { options, total };
}

/** The roster read as the family's transport issues it, so this file does not restate the envelope or its refusals. */
function fetchPartnerPage(url: string) {
  return fetchPartnerRead<PartnerPage>(url);
}

/** What one picker read produces: the family's read result, with the checked page in place of the raw payload. */
type PartnerPageReadResult = Awaited<ReturnType<typeof fetchPartnerPage>>;

/** Issues one picker read and checks its payload; a refusal travels on untouched, because a refusal is not an absence. */
async function readPartnerPage(url: string): Promise<PartnerPageReadResult> {
  const result = await fetchPartnerPage(url);
  if (result.kind !== "envelope") {
    return result;
  }
  const envelope: ReadEnvelope<PartnerPage> = { ...result.envelope, data: pageOf(result.envelope.data, url, result.envelope.source) };
  return { kind: "envelope", envelope };
}

/** The address of one picker read: the roster job, asked with the search, page and size the roster's own grammar produced. */
function pickerReadUrl(request: RosterRequestParams): string {
  const search = new URLSearchParams();
  search.set(ROSTER_QUERY_PARAM, ROSTER_READ_JOB.roster);
  if (request.search !== undefined && request.search !== "") {
    search.set(READ_PARAM.search, request.search);
  }
  // The read refuses a size with no page, so both are always stated together.
  search.set(READ_PARAM.page, String(request.page));
  search.set(READ_PARAM.pageSize, String(request.pageSize));
  return `${PARTNERS_READ_PATH}?${search.toString()}`;
}

/** Whether the scope carries the four identifiers a read runs under, so a search with no authority behind it is never issued. */
function scopeIsResolved(scope: Scope): boolean {
  return [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
}

/** The worker's typing, settled: the term that is actually sent to the service, so a name is one read rather than one per key. */
function useSettledTerm(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

/**
 * The picker's own bounded read of the roster: the first matches of the settled term, beside the whole-result count they
 * are a page of. The scope leads the cache key, so a context switch clears it with the rest of the previous context, and
 * the page already on screen stays while the next one lands — a pending read is a busy list, never an empty one.
 */
function usePartnerPickerPage(scope: Scope, term: string, enabled: boolean) {
  const request = useMemo<RosterRequestParams>(
    // The roster's own grammar resolves a page size to the window its surface serves; this control reads a bounded page
    // of matches instead, so the size the read is asked with is stated here rather than left to that surface's window.
    () => ({
      ...rosterRequestParams({ search: term, facets: {}, sort: null, page: PICKER_PAGE, pageSize: PICKER_PAGE_SIZE, columnVisibility: {} }),
      pageSize: PICKER_PAGE_SIZE,
    }),
    [term],
  );
  const url = useMemo(() => pickerReadUrl(request), [request]);
  const resolved = scopeIsResolved(scope);
  return useQuery<PartnerPageReadResult>({
    queryKey: queryKey(scope, PARTNER_KEY.roster, { job: ROSTER_READ_JOB.roster, search: request.search ?? "", page: request.page, pageSize: request.pageSize }),
    queryFn: () => readPartnerPage(url),
    placeholderData: keepPreviousData,
    enabled: enabled && resolved,
  });
}

/** The name the combobox echoes for a chosen record; the reference, never this, is what identifies it. */
function displayNameOf(selection: PartnerSelection): string {
  return selection.displayName;
}

/** What both modes of the control need from {@link PartnerPicker}, beside the field wiring each one renders itself. */
interface PartnerComboboxProps {
  readonly options: readonly PartnerSelection[];
  readonly excluded: ReadonlySet<string>;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly term: string;
  readonly onTermChange: (value: string) => void;
  readonly selected: readonly PartnerSelection[];
  readonly onCommit: (next: readonly PartnerSelection[]) => void;
}

/**
 * The popup both modes share: the busy state while the service answers, the sentence a search with no match states, and
 * the options themselves. Each option states its name isolated from the surrounding direction, its kind in words and the
 * opaque reference it would be chosen by, so two records that read alike are two distinguishable choices rather than one
 * collapsed entry. An option already chosen elsewhere is listed and refused rather than silently dropped, so the list a
 * worker sees is the result the read admitted.
 */
function PartnerComboboxPopup({ options, excluded, pending, term }: Pick<PartnerComboboxProps, "options" | "excluded" | "pending" | "term">): ReactElement {
  const noMatch = !pending && options.length === 0;
  return (
    <ComboboxContent className="w-80 max-w-[calc(100vw-2rem)]">
      {pending ? (
        <div className="p-1.5">
          <StateNotice kind="loading" title={PICKER_COPY.loading} loadingLines={2} className="border-0 p-3" />
        </div>
      ) : null}
      {/* A pending read states that it is reading; only a settled one may say the search found nothing. */}
      {noMatch ? <output className="block px-3.5 py-3 text-start text-sm text-pretty text-muted-foreground">{term === "" ? PICKER_COPY.noRecords : PICKER_COPY.noMatch}</output> : null}
      <ComboboxList>
        {(option: PartnerSelection) => {
          const reference = partnerSelectionRef(option);
          const isExcluded = excluded.has(reference);
          return (
            <ComboboxItem key={reference} value={option} disabled={isExcluded} className="items-start">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <bdi className="min-w-0 text-pretty break-words">{option.displayName}</bdi>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{kindLabelOf(option.kind)}</span>
                  <bdi className="mono-identifier break-words">{reference}</bdi>
                  {isExcluded ? <span>{PICKER_COPY.alreadyChosen}</span> : null}
                </span>
              </span>
            </ComboboxItem>
          );
        }}
      </ComboboxList>
    </ComboboxContent>
  );
}

/**
 * One-record mode: the combobox's own input is the field, echoes the chosen record's name and carries the single value.
 * Nothing is remembered here — the caller owns the value, and this control only reports the change it was given.
 */
function SinglePartnerCombobox({ field, options, excluded, pending, disabled, term, onTermChange, selected, onCommit }: PartnerComboboxProps & { readonly field: FormFieldControl }): ReactElement {
  const chosen = selected[0] ?? null;
  return (
    <Combobox<PartnerSelection, false, PartnerSelection>
      items={options}
      value={chosen}
      multiple={false}
      // The service has already searched the whole dataset, so a second filter here would hide a record the read admitted.
      filter={null}
      autoHighlight
      itemToStringLabel={displayNameOf}
      isItemEqualToValue={samePartnerSelection}
      disabled={disabled}
      onInputValueChange={onTermChange}
      onValueChange={(next) => {
        onCommit(next === null ? [] : [next]);
      }}
    >
      <ComboboxInput
        id={field.id}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid ? true : undefined}
        placeholder={PICKER_COPY.searchPlaceholder}
        showClear={chosen !== null}
        className="w-full"
        // A field that cannot search states that it cannot: the combobox's own input reads its disabled state from the
        // root, so the blocked state travels as a read-only, aria-disabled field rather than an enabled one that ignores
        // every keystroke. The trigger and the clear control beside it are disabled by the root as usual.
        readOnly={disabled}
        aria-disabled={disabled ? true : undefined}
      />
      <PartnerComboboxPopup options={options} excluded={excluded} pending={pending} term={term} />
    </Combobox>
  );
}

/**
 * List mode: the chosen records are the chips, each removed by its own control, and the field's input is the same search.
 * A chip states its name as text so its remove control is named after the record it removes; the options themselves
 * isolate their names in `<bdi>`, which is where an unknown-direction name sits beside other text.
 */
function MultiplePartnerCombobox({ field, options, excluded, pending, disabled, term, onTermChange, selected, onCommit }: PartnerComboboxProps & { readonly field: FormFieldControl }): ReactElement {
  return (
    <Combobox<PartnerSelection, true, PartnerSelection>
      multiple
      items={options}
      value={selected}
      filter={null}
      autoHighlight
      itemToStringLabel={displayNameOf}
      isItemEqualToValue={samePartnerSelection}
      disabled={disabled}
      onInputValueChange={onTermChange}
      onValueChange={(next) => {
        onCommit(next);
      }}
    >
      <ComboboxChips>
        <ComboboxValue>
          {(chosen: readonly PartnerSelection[]) => (
            <>
              {chosen.map((entry) => (
                <ComboboxChip key={partnerSelectionRef(entry)}>{entry.displayName}</ComboboxChip>
              ))}
            </>
          )}
        </ComboboxValue>
        <ComboboxChipsInput id={field.id} aria-describedby={field.describedBy} aria-invalid={field.invalid ? true : undefined} placeholder={PICKER_COPY.searchPlaceholder} disabled={disabled} readOnly={disabled} className="min-w-44" />
      </ComboboxChips>
      <PartnerComboboxPopup options={options} excluded={excluded} pending={pending} term={term} />
    </Combobox>
  );
}

/**
 * The one partner selector: the labelled field, the settled search it sends to the service, the single or list-shaped
 * choice that search produces, and the shared notice for every state that is not a result. An unreadable, denied or
 * refused source keeps the field in place and states why, because a control that vanished would leave the form's label
 * pointing at nothing.
 */
export default function PartnerPicker(props: PartnerPickerProps): ReactElement {
  const { scope, label, description, error, disabled = false, excludeRefs, onLinkIntended, headingLevel = 3, className, name } = props;
  const generatedName = useId();
  const fieldName = name ?? `partner-picker-${generatedName}`;
  const [typed, setTyped] = useState("");
  const settled = useSettledTerm(typed, SEARCH_DEBOUNCE_MS);
  const term = settled.trim();
  const resolved = scopeIsResolved(scope);
  const read = usePartnerPickerPage(scope, term, !disabled);
  const excluded = new Set(excludeRefs ?? []);
  // The caller's value, in the one shape both modes read from; the union is narrowed here rather than in each mode.
  const selected: readonly PartnerSelection[] = props.mode === "multiple" ? props.value : props.value === null ? [] : [props.value];

  const result = read.data;
  // An answer read under another context is not this field's answer: the roster read derives its authority from the
  // session, so an envelope whose scope is not the scope this field works in states nothing about this context and is
  // never counted, offered or shown. A pending read is still pending rather than a refusal.
  const answered = result !== undefined && result.kind === "envelope" && sameScope(result.envelope.scope, scope) ? result.envelope : null;
  const elsewhere = result !== undefined && result.kind === "envelope" && !sameScope(result.envelope.scope, scope);
  const refusal = result !== undefined && result.kind !== "envelope" ? result : null;
  const options = answered?.data.options ?? [];
  const total = answered?.data.total ?? null;
  const pending = !disabled && (read.isPending || (elsewhere && read.isFetching));
  const readBroken = !disabled && (read.isError || refusal !== null || !resolved || (elsewhere && !read.isFetching));
  const nothingYet = !disabled && !readBroken && answered !== null && total === 0 && term === "";
  const controlDisabled = disabled || readBroken || nothingYet;

  const commit = (next: readonly PartnerSelection[]): void => {
    if (props.mode === "multiple") {
      props.onValueChange(next);
    } else {
      props.onValueChange(next[0] ?? null);
    }
    if (onLinkIntended === undefined) {
      return;
    }
    // Only a record that has just been added is a link the worker intends; a removal states nothing to review.
    for (const entry of next) {
      if (!selected.some((chosenEntry) => samePartnerSelection(chosenEntry, entry))) {
        onLinkIntended(entry);
      }
    }
  };

  const retry = (): void => {
    void read.refetch();
  };

  let replacement: ReactElement | null = null;
  if (!disabled) {
    if (!resolved) {
      replacement = <StateNotice kind="denied" title={PICKER_COPY.contextTitle} description={PICKER_COPY.contextBody} headingLevel={headingLevel} />;
    } else if (read.isError) {
      replacement = <StateNotice kind="unavailable" title={PICKER_COPY.unavailableTitle} description={PICKER_COPY.unavailableBody} retry={{ label: PICKER_COPY.retry, onClick: retry }} headingLevel={headingLevel} />;
    } else if (elsewhere && !read.isFetching) {
      replacement = <StateNotice kind="denied" title={PICKER_COPY.elsewhereTitle} description={PICKER_COPY.elsewhereBody} headingLevel={headingLevel} />;
    } else if (refusal === null) {
      replacement = nothingYet ? <StateNotice kind="empty" title={PICKER_COPY.emptyTitle} description={PICKER_COPY.emptyBody} action={{ label: PICKER_COPY.emptyAction, href: PICKER_COPY.emptyHref }} headingLevel={headingLevel} /> : null;
    } else if (refusal.kind === "unavailable") {
      // A source that is down is an outage with an identity, never an empty list and never a zero.
      replacement = <StateNotice kind="unavailable" title={PICKER_COPY.unavailableTitle} description={refusal.unavailable.guidance} source={refusal.unavailable.source} retry={{ label: PICKER_COPY.retry, onClick: retry }} headingLevel={headingLevel} />;
    } else if (refusal.kind === "denied") {
      replacement = <StateNotice kind="denied" title={PICKER_COPY.deniedTitle} description={PICKER_COPY.deniedBody} reasonCode={refusal.denied.reasonCode} headingLevel={headingLevel} />;
    } else {
      // This picker's own request was refused, so the source never failed and no permission was denied.
      replacement = <StateNotice kind="refused" title={PICKER_COPY.refusedTitle} description={refusalSummary(refusal.refused)} headingLevel={headingLevel} />;
    }
  }

  const showCount = replacement === null && total !== null && total > options.length;
  const showExcludeNote = replacement === null && options.some((option) => excluded.has(partnerSelectionRef(option)));
  const comboboxProps: PartnerComboboxProps = { options, excluded, pending, disabled: controlDisabled, term, onTermChange: setTyped, selected, onCommit: commit };

  return (
    <FormField label={label} name={fieldName} description={description} error={error} className={cn("min-w-0", className)}>
      {(field) => {
        // A field that cannot search says why as part of its own description, so the reason is heard by whoever reaches
        // the control rather than only by whoever reads past it.
        const reasonId = `${field.id}-read-state`;
        const describedBy = replacement === null ? field.describedBy : field.describedBy === undefined ? reasonId : `${field.describedBy} ${reasonId}`;
        return (
          <div className="flex min-w-0 flex-col gap-2">
            {props.mode === "multiple" ? (
              <MultiplePartnerCombobox {...comboboxProps} field={{ ...field, describedBy }} />
            ) : (
              <SinglePartnerCombobox {...comboboxProps} field={{ ...field, describedBy }} />
            )}
            {replacement === null ? null : <div id={reasonId}>{replacement}</div>}
            {showCount || showExcludeNote ? (
              <div className="flex min-w-0 flex-col gap-1">
                {showCount && total !== null ? <p className="text-xs text-pretty text-muted-foreground">{PICKER_COPY.showingFirst(options.length, total)}</p> : null}
                {showExcludeNote ? <p className="text-xs text-pretty text-muted-foreground">{PICKER_COPY.excludeNote}</p> : null}
              </div>
            ) : null}
          </div>
        );
      }}
    </FormField>
  );
}

