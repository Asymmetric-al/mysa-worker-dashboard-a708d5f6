"use client";
import type { ReactElement } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
/** One fact a refusal is allowed to state beside its own words: a reason code, an operation identity, or the source that could not answer and its guidance. */
type NoticeDetail = { readonly label: string; readonly value: string; readonly guidance?: string };
/** One refused action of this journey: the closed words for its kind, then the one fact the answer is allowed to state, in the identifier face so a mixed-direction neighbour cannot reorder it. */
export default function ImportNotice({ destructive, title, lead, details }: { readonly destructive: boolean; readonly title: string; readonly lead: string; readonly details: readonly NoticeDetail[] }): ReactElement {
  return (
    <Alert variant={destructive ? "destructive" : "default"}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{lead}</p>
        {details.map((detail) => (
          <p key={detail.label}>
            {`${detail.label} `}
            <bdi className="mono-identifier">{detail.value}</bdi>.{detail.guidance === undefined ? null : ` ${detail.guidance}`}{" "}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}
