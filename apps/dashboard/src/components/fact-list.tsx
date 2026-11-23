import { Fragment, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/cn";
/** The three classes one surface states its facts with: the row frame, the term and the value. */
export type FactFrame = { readonly rowClassName?: string; readonly termClassName?: string; readonly valueClassName?: string };
/** One fact: its term, and the value every fact of a group states. */
export type FactSpec = { readonly term: string; readonly value: ReactNode; readonly valueClassName?: string };
export type FactProps = { readonly term: string; readonly value?: ReactNode; readonly children?: ReactNode };
export type FactListProps = FactFrame & { readonly facts: readonly FactSpec[]; readonly className?: string; readonly valueClassName?: string };
const DEFAULT_ROW_CLASS = "flex min-w-0 flex-wrap items-baseline gap-x-2";
const DEFAULT_TERM_CLASS = "text-muted-foreground";
const DEFAULT_VALUE_CLASS = "min-w-0";
function frameOf(frame: FactFrame): Required<FactFrame> {
  return { rowClassName: frame.rowClassName ?? DEFAULT_ROW_CLASS, termClassName: frame.termClassName ?? DEFAULT_TERM_CLASS, valueClassName: frame.valueClassName ?? DEFAULT_VALUE_CLASS };
}
function rowOf({ term, value, children }: FactProps, frame: Required<FactFrame>, valueClassName: string): ReactElement {
  return (
    <div className={frame.rowClassName}>
      <dt className={frame.termClassName}>{term}</dt>
      <dd className={valueClassName}>{value ?? children}</dd>
    </div>
  );
}
/** One fact stated as a term and a value inside the description list the caller owns. */
export function Fact(props: FactProps): ReactElement {
  const frame = frameOf({});
  return rowOf(props, frame, frame.valueClassName);
}
/** The facts one surface states in its own frame, so the classes are written once and every row is the same row. */
export function factFrame(frame: FactFrame): (props: FactProps) => ReactElement {
  const bound = frameOf(frame);
  return function StatedFact(props: FactProps): ReactElement {
    return rowOf(props, bound, bound.valueClassName);
  };
}
/** A group of facts, so a set that differs only in its data is one list of rows rather than a block of markup per fact. */
export function FactList({ facts, className, rowClassName, termClassName, valueClassName }: FactListProps): ReactElement {
  const frame = frameOf({ rowClassName, termClassName, valueClassName });
  return (
    <dl className={cn(className)}>
      {facts.map((fact) => (
        <Fragment key={fact.term}>{rowOf({ term: fact.term, value: fact.value }, frame, cn(fact.valueClassName ?? frame.valueClassName))}</Fragment>
      ))}
    </dl>
  );
}
export default FactList;
