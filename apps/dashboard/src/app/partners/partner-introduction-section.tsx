"use client";
/** The record-introduction section of a partner record: the record body states the facts an introduction is recorded against and the app layer is where the referrals form is composed into it, because the two families never import each other. The section renders nothing where no record body states those facts, so handing it to a body that did not admit an introduction adds no control. */
import type { ReactElement } from "react";
import { usePartnerIntroductionFacts } from "@/features/partners/components/partner-record-body";
import ReferralIntroductionForm from "@/features/referrals/components/referral-introduction-form";
export default function PartnerIntroductionSection(): ReactElement | null {
  const facts = usePartnerIntroductionFacts();
  if (facts === null) return null;
  return <ReferralIntroductionForm scope={facts.scope} partnerId={facts.partnerId} expectedRevision={facts.expectedRevision} sourceReference={facts.sourceReference} sourceZone={facts.sourceZone} headingLevel={facts.headingLevel} />;
}
