"use client";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { scopeKey } from "@/components/context-switch-guard";
import { isRecord } from "@/lib/guards";
import { asOfInstant, fetchRead } from "@/lib/read-transport";
import type { Scope, reads } from "@/modules/data-service";
export type SupportOverviewRead = Awaited<ReturnType<typeof reads.support.readSupportOverview>>;
type SupportOverviewEnvelope = Extract<SupportOverviewRead, { readonly kind: "envelope" }>["envelope"];
export type UseSupportOverviewOptions = { readonly scope: Scope; readonly initialEnvelope?: SupportOverviewRead | undefined };
/** Reads the Support overview in the given scope: wraps `reads.support.readSupportOverview` and answers `envelope | denied | unavailable | refused`, unchanged. */ export const useSupportOverview = ({ scope, initialEnvelope }: UseSupportOverviewOptions): UseQueryResult<SupportOverviewRead> =>
  useQuery({ queryKey: [...scopeKey(scope), "overview"], queryFn: fetchSupportOverview, staleTime: 30_000, refetchOnMount: false, initialData: initialEnvelope, initialDataUpdatedAt: initialEnvelope === undefined || initialEnvelope.kind !== "envelope" ? undefined : asOfInstant(initialEnvelope.envelope.asOf) });
const isOverviewData = (value: unknown): boolean => isRecord(value) && isRecord(value.report) && Array.isArray(value.monthlyEquivalent) && Array.isArray(value.buckets) && Array.isArray(value.commitmentKinds);
const fetchSupportOverview = async (): Promise<SupportOverviewRead> => fetchRead<SupportOverviewEnvelope["data"], SupportOverviewEnvelope["coverage"]>({ url: "/api/support", admits: isOverviewData });
