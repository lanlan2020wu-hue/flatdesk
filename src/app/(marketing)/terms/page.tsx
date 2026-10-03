import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import LegalPage, { Section } from "@/components/LegalPage";
import { PLAN, usd } from "@/lib/pricing";
import { LEGAL_UPDATED, SITE } from "@/lib/site";
import { TRIAL_DAYS } from "@/lib/billing";

export const metadata: Metadata = pageMeta({
  title: "Terms of service",
  description: "The agreement between Flatdesk and the teams that use it.",
  path: "/terms",
});

export default function TermsPage() {
  const mail = <a href={`mailto:${SITE.contactEmail}`} className="link text-accent">{SITE.contactEmail}</a>;
  return (
    <LegalPage
      title="Terms of service"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          These terms are the agreement between {SITE.legalName} (&ldquo;we&rdquo;) and the business that signs up for Flatdesk
          (&ldquo;you&rdquo;). By creating a team or using the service you accept them on behalf of that business.
        </p>
      }
    >
      <Section title="1. The service">
        <p>
          Flatdesk is a help desk. It has a shared inbox for email and website chat, macros and rules, reports, data import and export, and AI answers
          that draw on the notes and saved replies you give it. We may improve or change features, and we&apos;ll tell you before removing
          anything you rely on.
        </p>
      </Section>

      <Section title="2. Accounts">
        <p>
          You need a team account to use Flatdesk, and each person on it needs their own sign-in. You are responsible for who you invite, for
          keeping sign-ins secure, and for what happens under your account. Tell us at {mail} if you think an account has been compromised.
        </p>
      </Section>

      <Section title="3. Price, trial and billing">
        <ul className="grid list-disc gap-2 pl-5">
          <li>
            New teams get {TRIAL_DAYS} days free with no card, with {PLAN.trialPerAgent} AI answers per agent for the whole trial and no
            overage. To keep using Flatdesk after that, or to get the full monthly AI allowance sooner, an admin adds a card. The first charge
            is on the day the trial ends. A card added in the last two days of the trial is first charged 2 days after it&apos;s added.
          </li>
          <li>
            The plan is {usd(PLAN.seatPrice)} per agent per month billed monthly, or {usd(PLAN.annualSeatPrice)} per agent per month billed
            yearly ({usd(PLAN.annualSeatPrice * 12)} per agent per year), in advance through Stripe. An agent is a member of your team.
            Viewers, who can read but not reply, aren&apos;t billed. On monthly billing, adding or removing members changes the next bill,
            prorated. On yearly billing, members added during the year are charged right away for the rest of that year. A seat freed during
            the year isn&apos;t refunded. It stays paid until the renewal, and the next person you add takes it at no charge. Switching from
            monthly to yearly starts the year that day, with unused monthly time credited.
          </li>
          <li>
            Each month includes {PLAN.includedPerAgent} AI answers per agent, shared by the team. When they run out, AI answers pause
            until the next month and nothing extra is charged, unless an admin turns on overage. With overage on, each AI answer past the
            allowance costs {usd(PLAN.overageRate, true)} and is billed after the month ends: on the next invoice for monthly billing, or on
            its own invoice for yearly billing. An AI answer is a conversation the AI finished without handing it to your team, including up
            to 3 follow-up answers. An admin can refund a wrong AI answer on the AI receipts page and it stops counting. Refunds are open until
            that month is billed on the 1st of the next month, and each month a team can refund up to one in five of its included answers.
          </li>
          <li>Prices exclude taxes, which are added where the law requires.</li>
          <li>
            We&apos;ll give you at least 30 days&apos; notice by email before changing the price. The change applies from your next billing
            period after that notice.
          </li>
          <li>If a payment fails, Stripe retries it over the following days. If it still fails, the account pauses until it goes through. Nothing is deleted.</li>
        </ul>
      </Section>

      <Section title="4. Cancelling">
        <p>
          You can cancel any time from Settings, under billing. The plan runs to the end of the period you&apos;ve paid for (the month, or
          the year on yearly billing) and isn&apos;t renewed. We don&apos;t refund partial periods, except where the law says we must. You can export your data from Settings at any time,
          before or after cancelling: tickets, messages, customers and macros, as CSV or JSON. Attachments download from each ticket.
        </p>
      </Section>

      <Section title="5. Your data">
        <p>
          Everything your team and your customers put into Flatdesk is yours. You give us permission to store, process and send it only to run
          the service for you, as described in our <Link href="/privacy" className="link text-accent">privacy policy</Link>. We don&apos;t
          sell it and we don&apos;t use it to train AI models. When you ask us to delete your team, we delete your data within 30 days, except where the
          law requires us to keep records such as invoices.
        </p>
        <p>
          You are responsible for having the right to send us the data you put in, including your customers&apos; messages, and for telling
          your customers that you use a help desk and AI answers where the law requires it.
        </p>
      </Section>

      <Section title="6. AI answers">
        <p>
          AI answers are written by a large language model from the material you provide. They can be wrong. You decide whether the AI is
          switched on, what it knows, and whether it keeps answering after the allowance, and every AI reply tells the customer they can ask
          for a person at any time. You are responsible for the answers sent in your name, just as you are for your team&apos;s replies.
        </p>
      </Section>

      <Section title="7. Acceptable use">
        <p>Don&apos;t use Flatdesk to:</p>
        <ul className="grid list-disc gap-2 pl-5">
          <li>send spam or bulk marketing email, or mail people who haven&apos;t contacted you;</li>
          <li>break the law, or store content you have no right to store;</li>
          <li>send malware, or try to break, overload or get around the security of the service;</li>
          <li>resell the service or use it to build a competing product.</li>
        </ul>
        <p>We may suspend an account that does these things. Where we can, we&apos;ll warn you first and give you time to fix it.</p>
      </Section>

      <Section title="8. Availability and support">
        <p>
          We work to keep Flatdesk running and your data backed up, but we don&apos;t promise it will never be interrupted.
          Email {mail} for help. We aim to reply within one business day.
        </p>
      </Section>

      <Section title="9. Liability">
        <p>
          The service is provided &ldquo;as is&rdquo;. To the extent the law allows, neither of us is liable to the other for indirect or
          consequential losses such as lost profits or lost business, and each party&apos;s total liability under these terms is limited to
          the amount you paid us in the 12 months before the claim. These limits don&apos;t apply to your payment obligations, or to either
          party&apos;s liability that can&apos;t be limited by law.
        </p>
      </Section>

      <Section title="10. Changes and ending the agreement">
        <p>
          We may update these terms. For meaningful changes we&apos;ll email your team&apos;s admins at least 30 days ahead. If you
          don&apos;t agree, you can cancel before they take effect. Either of us can end this agreement by cancelling. We&apos;ll give at
          least 30 days&apos; notice unless you&apos;ve broken these terms.
        </p>
      </Section>

      <Section title="11. Law and contact">
        <p>
          These terms are governed by the laws of {SITE.governingLaw}. Questions or legal notices go to {mail}.
        </p>
      </Section>
    </LegalPage>
  );
}
