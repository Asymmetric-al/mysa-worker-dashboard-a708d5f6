"use client";
import type { ReactNode, ReactElement } from "react";
import type { ZodError } from "zod";
import { factFrame } from "@/components/fact-list";
import StatusBadge, { statusBadgeProps, VALUE_STATE_WORDS } from "@/components/status-badge";
import { countFormatOf } from "@/lib/count-format";
import { assertNever } from "@/lib/result";
import { fieldErrorsFromInvalid, type FieldErrorLookup } from "@/components/form-field";
import type { ValueState } from "@/modules/data-service";
import { PAGE_SIZE_CAP, PAGE_SIZE_DEFAULT } from "@/modules/support/report";
/** The whole number a page or page-size parameter states, read by the list grammar's own rule so this family keeps one format; re-exported here because every surface of the family reaches for it beside these figures. */ export { integerOf, pageNumberOf } from "../query/initiatives-query";
/** The page size a read may be asked for: the family's own default, its cap, or a value the request states between them. */ export const pageSizeNumberOf = (value: number): number => (!Number.isSafeInteger(value) || value <= 0 ? PAGE_SIZE_DEFAULT : value >= PAGE_SIZE_CAP ? PAGE_SIZE_CAP : PAGE_SIZE_DEFAULT);
/** The value state the read recorded for one field, or `value` when it recorded none. */ export const statedState = (valueStates: Readonly<Record<string, ValueState>>, path: string): ValueState => valueStates[path] ?? "value";
/** One count rendered from the value state the read recorded for it. */ export function CountFigure({ count, state }: { readonly count: number; readonly state: ValueState }): ReactElement {
  if (!Number.isFinite(count)) return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "unknown")} />;
  switch (state) {
    case "value":
    case "zero":
      return <span className="tabular-figures">{countFormatOf().format(count)}</span>;
    case "incomplete-subtotal":
      return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span className="tabular-figures">{countFormatOf().format(count)}</span>
          <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, "incomplete-subtotal")} />
        </span>
      );
    case "unknown":
    case "withheld":
    case "unavailable":
      return <StatusBadge {...statusBadgeProps(VALUE_STATE_WORDS, state)} />;
    default:
      return assertNever(state, "Unhandled value state");
  }
}
/** A civil date or instant exactly as the read supplies it, isolated so a mixed-direction neighbour cannot reorder it. */ export const StatedInstant = ({ value }: { readonly value: string }): ReactElement => (
  <bdi>
    <time {...{ className: "tabular-figures", dateTime: value }}>{value}</time>
  </bdi>
);
/** One labelled row of a review, so a step names exactly what it will record. */ export const ReviewFact = factFrame({ rowClassName: "flex min-w-0 flex-col gap-1", termClassName: "text-muted-foreground", valueClassName: "min-w-0" });
/** One row of a fact list: the term a surface states, and the value it states for that term. */ export type FactEntry = { readonly term: string; readonly value: ReactNode };
/** A run of labelled facts stated from one table: the list and its one map live here, so a surface states its facts once. */
export const FactList = ({ className, rows, row }: { readonly className: string; readonly rows: readonly FactEntry[]; readonly row: (entry: FactEntry) => ReactElement }): ReactElement => <dl className={className}>{rows.map((entry) => row(entry))}</dl>;
/** One term and its value in an inline fact list, without a list of its own. */ export const TermFact = factFrame({ rowClassName: "flex min-w-0 flex-wrap items-baseline gap-x-1.5", termClassName: "text-muted-foreground", valueClassName: "min-w-0 break-words" });
/** The per-field messages a schema refusal carries, keyed exactly as the service's `invalid` outcome is keyed. */ export function errorsOf(error: ZodError): FieldErrorLookup {
  const fields: Record<string, readonly string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.map((segment) => String(segment)).join(".");
    const messages = fields[path] ?? [];
    fields[path] = messages.includes(issue.message) ? messages : [...messages, issue.message];
  }
  return fieldErrorsFromInvalid({ fields });
}
