"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { queryKey } from "@/components/context-switch-guard";
import { FormField, refusalSummary, type FormFieldControl } from "@/components/form-field";
import StateNotice from "@/components/state-notice";
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxItem, ComboboxList, ComboboxValue } from "@/components/ui/combobox";
import { cn } from "@/lib/cn";
import { formatSourceReference, sameSourceReference, type SourceReference } from "@/lib/ids";
import { PARTNER_KINDS, sameScope, type PartnerKind, type ReadEnvelope, type Scope } from "@/modules/data-service/envelope";
import { FACET_VALUE_LABELS } from "../copy/facets";
import { fetchPartnerRead, PARTNER_KEY, PartnerReadTransportError } from "../hooks/use-partner-mutations";
import { PARTNERS_READ_PATH, ROSTER_PAGE_SIZE_CAP, ROSTER_QUERY_PARAM, ROSTER_READ_JOB, rosterRequestParams, type RosterRequestParams } from "../hooks/use-roster-query";
import { isSharedRecord, SHARED_RECORD_FACET, SHARED_RECORD_FACET_SELECTION } from "../record-class";
const PICKER_COPY = {
  searchPlaceholder: "Search partners by name",
  emptyTitle: "No shared record exists yet",
  emptyBody: "This control offers only the roster's shared records, and it holds none yet, so the first useful step is bringing contacts in rather than picking one. A private preparation record stays the worker's own and is never a participant or a link target.",
  elsewhereBody: "The roster answered under a different organisation, ministry or support subject from the one this field is working in, so nothing from that answer is shown, counted or offered here.",
  unavailableTitle: "The partner records could not be read",
  retry: "Read the roster again",
  showingFirst: (shown: number, total: number): string => `Showing the first ${shown} of ${total} matching records. Refine the search to reach the rest.`,
} as const;
const PICKER_PAGE_SIZE = Math.min(20, ROSTER_PAGE_SIZE_CAP);
const READ_PARAM = { search: "search", facet: "facet", page: "page", pageSize: "pageSize" } as const;
export type PartnerSelection = { readonly partnerId: string; readonly kind: PartnerKind; readonly displayName: string; readonly source: SourceReference };
/** The opaque, source-qualified reference this selection and the record it came from share: what `excludeRefs` is compared against. */ export const partnerSelectionRef = (selection: PartnerSelection): string => formatSourceReference({ system: selection.source.system, reference: selection.partnerId });
/** Whether two selections denote the same record in the same source, so a chosen value is recognised after a re-read. */ export const samePartnerSelection = (left: PartnerSelection, right: PartnerSelection): boolean => left.partnerId === right.partnerId && sameSourceReference(left.source, right.source);
type PartnerPickerCommonProps = { readonly scope: Scope; readonly label: string; readonly description?: string; readonly error?: string | readonly string[]; readonly disabled?: boolean; readonly name?: string; readonly excludeRefs?: readonly string[]; readonly headingLevel?: 2 | 3 | 4; readonly className?: string };
export type PartnerPickerProps = PartnerPickerCommonProps & { readonly mode: "multiple"; readonly value: readonly PartnerSelection[]; readonly onValueChange: (value: readonly PartnerSelection[]) => void };
type PartnerPage = { readonly options: readonly PartnerSelection[]; readonly total: number };
const isPartnerKind = (value: string): value is PartnerKind => PARTNER_KINDS.some((kind) => kind === value);
/** The members this control needs off one roster row: the record's identity, its kind, the name the source gives it, and the record class it states — which decides whether the record may be offered at all. */
function rowOf(row: unknown): { readonly partnerId: string; readonly kind: PartnerKind; readonly displayName: string; readonly audience: string | null } | null {
  if (typeof row !== "object" || row === null) return null;
  const partner: unknown = (row as { partner?: unknown }).partner;
  if (typeof partner !== "object" || partner === null) return null;
  const { partnerId, kind, displayName, audience } = partner as { partnerId?: unknown; kind?: unknown; displayName?: unknown; audience?: unknown };
  if (typeof partnerId !== "string" || partnerId === "") return null;
  if (typeof displayName !== "string" || displayName === "") return null;
  if (typeof kind !== "string" || !isPartnerKind(kind)) return null;
  return { partnerId, kind, displayName, audience: typeof audience === "string" ? audience : null }; // The class is read as the row stated it: a row that states none is left unshared, so it is never offered.
}
/** Whether the read reported the record-class filter among the ones it could not apply: a closed facet offers a value only while the scope holds a record of that class, so this is how the read says the scope holds no shared record at all — not that the search matched none. */
const classFilterUnapplied = (value: unknown): boolean => Array.isArray(value) && value.some((entry) => typeof entry === "object" && entry !== null && (entry as { readonly facet?: unknown }).facet === SHARED_RECORD_FACET.id);
function pageOf(data: unknown, url: string, source: SourceReference): PartnerPage {
  const payload = typeof data === "object" && data !== null ? (data as { rows?: unknown; total?: unknown; unappliedFacets?: unknown }) : {};
  const { rows, total, unappliedFacets } = payload;
  if (!Array.isArray(rows) || typeof total !== "number" || !Number.isFinite(total)) throw new PartnerReadTransportError(url, undefined, "a payload that is not the roster page this picker reads");
  const classApplied = !classFilterUnapplied(unappliedFacets);
  const options: PartnerSelection[] = [];
  for (const row of rows) {
    const stated = rowOf(row);
    if (stated === null) throw new PartnerReadTransportError(url, undefined, "a roster row that states no partner identity");
    if (!isSharedRecord(stated)) {
      // A row of another class beside a read that applied the class is a fault of the response boundary, so it never becomes an option; beside a read that could not apply it, the row is simply not a record this control offers.
      if (classApplied) throw new PartnerReadTransportError(url, undefined, "a roster row of a record class this control never offers");
      continue;
    }
    const { partnerId, kind, displayName } = stated;
    options.push({ partnerId, kind, displayName, source });
  }
  return { options, total: classApplied ? total : options.length }; // The read's own count is the shared class's when it applied the filter; when it could not, the rows it answered are of no class this control offers, so the count is the records actually left to offer.
}
const fetchPartnerPage = (url: string) => fetchPartnerRead<PartnerPage>(url);
type PartnerPageReadResult = Awaited<ReturnType<typeof fetchPartnerPage>>;
async function readPartnerPage(url: string): Promise<PartnerPageReadResult> {
  const result = await fetchPartnerPage(url);
  if (result.kind !== "envelope") return result;
  const envelope: ReadEnvelope<PartnerPage> = { ...result.envelope, data: pageOf(result.envelope.data, url, result.envelope.source) };
  return { kind: "envelope", envelope };
}
/** The address of one picker read: the roster job, asked with the search, the record class, the page and the size the roster's own grammar produced. */ function pickerReadUrl(request: RosterRequestParams): string {
  const search = new URLSearchParams();
  search.set(ROSTER_QUERY_PARAM, ROSTER_READ_JOB.roster);
  if (request.search !== undefined && request.search !== "") search.set(READ_PARAM.search, request.search);
  for (const expression of request.facet ?? []) search.append(READ_PARAM.facet, expression); // The record class travels as the roster's own facet expressions, so the rows and the whole-result count this control states are the shared class's rather than a filtered page of every record.
  search.set(READ_PARAM.page, String(request.page));
  search.set(READ_PARAM.pageSize, String(request.pageSize));
  return `${PARTNERS_READ_PATH}?${search.toString()}`;
}
const scopeIsResolved = (scope: Scope): boolean => [scope.organizationId, scope.ministryId, scope.supportSubjectId, scope.principalId].every((identifier) => typeof identifier === "string" && identifier !== "");
function useSettledTerm(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
/** The picker's own bounded read of the roster: the first matches of the settled term, beside the whole-result count they are a page of. It is asked for the shared record class, so neither its rows nor its count includes a record this control could never offer. */
function usePartnerPickerPage(scope: Scope, term: string, enabled: boolean) {
  // The roster's own grammar resolves a page size to the window its surface serves, so the size this bounded control reads is stated here rather than left to that window. It states no giving scope: this control offers records, and reads no figure over a currency or a period.
  const request = useMemo<RosterRequestParams>(() => ({ ...rosterRequestParams({ search: term, facets: SHARED_RECORD_FACET_SELECTION, sort: null, page: 1, pageSize: PICKER_PAGE_SIZE, columnVisibility: {}, currency: null, period: null, timeZone: null }), pageSize: PICKER_PAGE_SIZE }), [term]);
  const url = useMemo(() => pickerReadUrl(request), [request]);
  const resolved = scopeIsResolved(scope);
  // Every variable the read is asked with is in the key, the facet selection included, so a page read for one record class is never served from an entry asked for another.
  return useQuery<PartnerPageReadResult>({
    queryKey: queryKey(scope, PARTNER_KEY.roster, { job: ROSTER_READ_JOB.roster, search: request.search ?? "", facet: request.facet ?? [], page: request.page, pageSize: request.pageSize }),
    queryFn: () => readPartnerPage(url),
    placeholderData: keepPreviousData,
    enabled: enabled && resolved,
  });
}
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
function PartnerComboboxPopup({ options, excluded, pending, term }: Pick<PartnerComboboxProps, "options" | "excluded" | "pending" | "term">): ReactElement {
  const noMatch = !pending && options.length === 0;
  return (
    <ComboboxContent className="w-80 max-w-[calc(100vw-2rem)]">
      {pending ? (
        <div className="p-1.5">
          <StateNotice kind="loading" title="Reading the partner records this search matches" loadingLines={2} className="border-0 p-3" />
        </div>
      ) : null}
      {noMatch ? <output className="block px-3.5 py-3 text-start text-sm text-pretty text-muted-foreground">{term === "" ? "This roster holds no record this control can offer yet." : "No partner record matches that search. Try fewer words, or a different spelling."}</output> : null}
      <ComboboxList>
        {(option: PartnerSelection) => {
          const reference = partnerSelectionRef(option);
          const isExcluded = excluded.has(reference);
          return (
            <ComboboxItem key={reference} value={option} disabled={isExcluded} className="items-start">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <bdi className="min-w-0 text-pretty break-words">{option.displayName}</bdi>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{FACET_VALUE_LABELS["contact-type"][option.kind] ?? option.kind}</span>
                  <bdi className="mono-identifier break-words">{reference}</bdi>
                  {isExcluded ? <span>already chosen</span> : null}
                </span>
              </span>
            </ComboboxItem>
          );
        }}
      </ComboboxList>
    </ComboboxContent>
  );
}
function PartnerCombobox({ field, options, excluded, pending, disabled, term, onTermChange, selected, onCommit }: PartnerComboboxProps & { readonly field: FormFieldControl }): ReactElement {
  const shared = { items: options, filter: null, autoHighlight: true, itemToStringLabel: (selection: PartnerSelection) => selection.displayName, isItemEqualToValue: samePartnerSelection, disabled, onInputValueChange: onTermChange };
  return (
    <Combobox<PartnerSelection, true, PartnerSelection> {...shared} multiple value={selected} onValueChange={onCommit}>
      <ComboboxChips>
        <ComboboxValue>
          {(picked: readonly PartnerSelection[]) => (
            <>
              {picked.map((entry) => (
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
/** The one partner selector: the labelled field, the settled search it sends to the service, and the shared notice for every state that is not a result. */ export default function PartnerPicker(props: PartnerPickerProps): ReactElement {
  const { scope, label, description, error, disabled = false, excludeRefs, headingLevel = 3, className, name } = props;
  const generatedName = useId();
  const [typed, setTyped] = useState("");
  const settled = useSettledTerm(typed, 250);
  const term = settled.trim();
  const resolved = scopeIsResolved(scope);
  const read = usePartnerPickerPage(scope, term, !disabled);
  const excluded = new Set(excludeRefs ?? []);
  const selected: readonly PartnerSelection[] = props.value;
  const result = read.data;
  const answered = result !== undefined && result.kind === "envelope" && sameScope(result.envelope.scope, scope) ? result.envelope : null;
  const elsewhere = result !== undefined && result.kind === "envelope" && !sameScope(result.envelope.scope, scope);
  const refusal = result !== undefined && result.kind !== "envelope" ? result : null;
  const options = answered?.data.options ?? [];
  const total = answered?.data.total ?? null;
  const pending = !disabled && (read.isPending || (elsewhere && read.isFetching));
  const readBroken = !disabled && (read.isError || refusal !== null || !resolved || (elsewhere && !read.isFetching));
  const nothingYet = !disabled && !readBroken && answered !== null && total === 0 && term === "";
  const controlDisabled = disabled || readBroken || nothingYet;
  const commit = (next: readonly PartnerSelection[]): void => props.onValueChange(next);
  const retry = (): void => void read.refetch();
  let replacement: ReactElement | null = null;
  if (!disabled) {
    if (!resolved) replacement = <StateNotice kind="denied" title="Choose a context before choosing a partner" description="A partner read runs under one organisation, ministry and support subject, so this search waits until a context is selected." headingLevel={headingLevel} />;
    else if (read.isError) {
      replacement = <StateNotice kind="unavailable" title={PICKER_COPY.unavailableTitle} description="The source behind the roster did not answer, so this control offers no record rather than an empty list or a count of zero." retry={{ label: PICKER_COPY.retry, onClick: retry }} headingLevel={headingLevel} />;
    } else if (elsewhere && !read.isFetching) replacement = <StateNotice kind="denied" title="These partner records were read in another context" description={PICKER_COPY.elsewhereBody} headingLevel={headingLevel} />;
    else if (refusal === null) replacement = nothingYet ? <StateNotice kind="empty" title={PICKER_COPY.emptyTitle} description={PICKER_COPY.emptyBody} action={{ label: "Bring in contacts from a file", href: "/partners/import" }} headingLevel={headingLevel} /> : null;
    else if (refusal.kind === "unavailable") replacement = <StateNotice kind="unavailable" title={PICKER_COPY.unavailableTitle} description={refusal.unavailable.guidance} source={refusal.unavailable.source} retry={{ label: PICKER_COPY.retry, onClick: retry }} headingLevel={headingLevel} />;
    else if (refusal.kind === "denied") {
      replacement = <StateNotice kind="denied" title="Partner records are not available in this context" description="No partner read is admitted for the context selected here, so this control offers no record rather than an empty list." reasonCode={refusal.denied.reasonCode} headingLevel={headingLevel} />;
    } else replacement = <StateNotice kind="refused" title="That search could not be asked" description={refusalSummary(refusal.refused)} headingLevel={headingLevel} />;
  }
  const showCount = replacement === null && total !== null && total > options.length;
  const showExcludeNote = replacement === null && options.some((option) => excluded.has(partnerSelectionRef(option)));
  const comboboxProps: PartnerComboboxProps = { options, excluded, pending, disabled: controlDisabled, term, onTermChange: setTyped, selected, onCommit: commit };
  return (
    <FormField label={label} name={name ?? `partner-picker-${generatedName}`} description={description} error={error} className={cn("min-w-0", className)}>
      {(field) => {
        const reasonId = `${field.id}-read-state`;
        const describedBy = replacement === null ? field.describedBy : field.describedBy === undefined ? reasonId : `${field.describedBy} ${reasonId}`;
        return (
          <div className="flex min-w-0 flex-col gap-2">
            <PartnerCombobox {...comboboxProps} field={{ ...field, describedBy }} />
            {replacement === null ? null : <div id={reasonId}>{replacement}</div>}
            {showCount || showExcludeNote ? (
              <div className="flex min-w-0 flex-col gap-1">
                {showCount && total !== null ? <p className="text-xs text-pretty text-muted-foreground">{PICKER_COPY.showingFirst(options.length, total)}</p> : null}
                {showExcludeNote ? <p className="text-xs text-pretty text-muted-foreground">A record already chosen in another field is listed here but cannot be chosen again.</p> : null}
              </div>
            ) : null}
          </div>
        );
      }}
    </FormField>
  );
}
