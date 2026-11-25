import { Fragment, type ReactElement, type ReactNode } from "react";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";
/** The three classes one surface states its facts with: the row frame, the term and the value. */ export type FactFrame = { readonly rowClassName?: string; readonly termClassName?: string; readonly valueClassName?: string };
/** One fact: its term, and the value every fact of a group states, optionally paired with a copyable literal string. */ export type FactSpec = { readonly term: string; readonly value: ReactNode; readonly valueClassName?: string; readonly copyValue?: string; readonly copyLabel?: string };
export type FactProps = { readonly term: string; readonly value?: ReactNode; readonly copyValue?: string; readonly copyLabel?: string; readonly children?: ReactNode };
export type FactListProps = FactFrame & { readonly facts: readonly FactSpec[]; readonly className?: string; readonly valueClassName?: string };
const frameOf = (frame: FactFrame): Required<FactFrame> => ({ rowClassName: frame.rowClassName ?? "flex min-w-0 flex-wrap items-baseline gap-x-2", termClassName: frame.termClassName ?? "text-muted-foreground", valueClassName: frame.valueClassName ?? "min-w-0" });
const rowOf = ({ term, value, copyValue, copyLabel, children }: FactProps, frame: Required<FactFrame>, valueClassName: string): ReactElement => (
  <div className={frame.rowClassName}>
    <dt className={frame.termClassName}>{term}</dt>
    <dd className={valueClassName}>
      {copyValue === undefined ? (
        (value ?? children)
      ) : (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span>{value ?? children}</span>
          <CopyButton value={copyValue} label={copyLabel ?? `Copy ${term.toLowerCase()}`} />
        </span>
      )}
    </dd>
  </div>
);
/** One fact stated as a term and a value inside the description list the caller owns. */ export function Fact(props: FactProps): ReactElement {
  const frame = frameOf({});
  return rowOf(props, frame, frame.valueClassName);
}
/** The facts one surface states in its own frame, so the classes are written once and every row is the same row. */ export function factFrame(frame: FactFrame): (props: FactProps) => ReactElement {
  const bound = frameOf(frame);
  return function StatedFact(props: FactProps): ReactElement {
    return rowOf(props, bound, bound.valueClassName);
  };
}
/** A group of facts, so a set that differs only in its data is one list of rows rather than a block of markup per fact. */ export function FactList({ facts, className, rowClassName, termClassName, valueClassName }: FactListProps): ReactElement {
  const frame = frameOf({ rowClassName, termClassName, valueClassName });
  return (
    <dl className={cn(className)}>
      {facts.map((fact) => (
        <Fragment key={fact.term}>{rowOf({ term: fact.term, value: fact.value, copyValue: fact.copyValue, copyLabel: fact.copyLabel }, frame, cn(fact.valueClassName ?? frame.valueClassName))}</Fragment>
      ))}
    </dl>
  );
}
export default FactList;
