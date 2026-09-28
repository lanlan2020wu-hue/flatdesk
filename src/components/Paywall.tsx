import { startCheckoutAction } from "@/app/app/actions";
import { PLAN, annualSavingsPct, usd } from "@/lib/pricing";

// Shown in place of the app once the free trial is over and the team has no
// plan. Email keeps arriving and nothing is deleted; exports stay open.
export default function Paywall({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="grid max-w-xl gap-6 px-4 py-10 md:px-8 md:py-14">
      <div className="grid gap-2">
        <p className="eyebrow">Free trial ended</p>
        <h1 className="font-display text-3xl">Pick up where you left off</h1>
        <p className="text-muted">
          Your tickets, macros and settings are all here, and new customer email is still being collected. Add a card to open the inbox
          again: {usd(PLAN.seatPrice)} per agent per month, or {usd(PLAN.annualSeatPrice)} billed yearly ({annualSavingsPct}% less), with{" "}
          {PLAN.includedPerAgent} AI resolutions per agent included either way. Cancel any time.
        </p>
      </div>
      {isAdmin ? (
        <div className="flex flex-wrap gap-3">
          <form action={startCheckoutAction}>
            <input type="hidden" name="interval" value="year" />
            <button className="btn btn-primary">Continue, pay yearly</button>
          </form>
          <form action={startCheckoutAction}>
            <input type="hidden" name="interval" value="month" />
            <button className="btn btn-secondary">Continue, pay monthly</button>
          </form>
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-surface px-4 py-3">Ask an admin on your team to add a card. They&apos;ll see a button here.</p>
      )}
      <div className="grid gap-2 border-t border-line pt-5 text-sm">
        <p className="font-medium">Leaving? Take your data with you.</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(["tickets", "messages", "customers", "macros"] as const).map((t) => (
            <li key={t}>
              <a href={`/app/export?type=${t}`} className="link capitalize text-accent">{t} (CSV)</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
