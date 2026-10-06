import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { Section } from "@/components/LegalPage";
import { pageMeta } from "@/lib/seo";
import { LAUNCHED, SITE, TRUST_UPDATED } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Who runs Flatdesk",
  description: "Who builds and sells Flatdesk, how new it is, and what happens to your data if Flatdesk ever shuts down.",
  path: "/about",
});

// Plain facts for the person deciding whether to trust a new vendor. No
// customer names, logos, numbers or quotes go here until real ones exist and
// the customer has agreed to be named.
export default function AboutPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`} className="link text-accent">{SITE.contactEmail}</a>;
  return (
    <LegalPage
      kicker={null}
      title="Who runs Flatdesk"
      updated={TRUST_UPDATED}
      intro={
        <p>
          Flatdesk is built and sold by {SITE.legalName}, and its terms are governed by the laws of {SITE.governingLaw}. It opened to paying teams
          in {LAUNCHED}.
        </p>
      }
    >
      <Section title="How new it is">
        <p>
          Very. There are no customer logos or reviews on this site because we&apos;d rather show none than make them up. If you need references from
          teams your size who have used Flatdesk for months, we can&apos;t give you those yet, and you should weigh that.
        </p>
        <p>
          What you can check yourself: the <Link href="/features/ai-test-drive" className="link text-accent">AI test drive</Link> on your own tickets,
          a <Link href="/sign-up" className="link text-accent">free trial</Link> with no card, the <Link href="/security" className="link text-accent">security page</Link> (including what&apos;s
          missing), and the <Link href="/dpa" className="link text-accent">data processing addendum</Link>.
        </p>
      </Section>

      <Section title="If Flatdesk shuts down">
        <p>
          A small vendor can disappear, so here is what we commit to in the <Link href="/terms" className="link text-accent">terms</Link>: at least 90
          days&apos; notice by email to every admin, the app and the full export (attachments included) working for all of that time, and no new charges
          after the notice. Your data then gets deleted, not sold.
        </p>
      </Section>

      <Section title="Talk to a person">
        <p>
          Email {mail}. There&apos;s no sales team, so you&apos;ll hear from whoever wrote the code. Security questionnaires, a countersigned DPA, or a call before
          you decide: ask, and you&apos;ll get a reply within one business day.
        </p>
      </Section>
    </LegalPage>
  );
}
