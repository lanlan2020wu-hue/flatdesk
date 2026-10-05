"use client";

import { useState } from "react";
import { csat, nps, responsesForMargin } from "@/lib/support-math";

const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

function CountInput({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="grid gap-1" htmlFor={id}>
      <span className="text-xs text-muted">{label}</span>
      <input id={id} type="number" min={0} className="field field-sm num" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.valueAsNumber)} />
    </label>
  );
}

export default function SurveyCalculator() {
  const [stars, setStars] = useState([3, 2, 5, 18, 32]);
  const [promoters, setPromoters] = useState(45);
  const [passives, setPassives] = useState(30);
  const [detractors, setDetractors] = useState(15);

  const c = csat(stars.map(n));
  const p = nps(n(promoters), n(passives), n(detractors));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-16">
      <section aria-labelledby="csat" className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <form className="card grid content-start gap-4 p-5 sm:p-6" onSubmit={(e) => e.preventDefault()}>
          <h2 id="csat" className="font-display text-2xl">CSAT</h2>
          <p className="text-sm text-muted">How many answers you got at each rating, 1 (very unsatisfied) to 5 (very satisfied).</p>
          <div className="grid grid-cols-5 gap-2">
            {stars.map((v, i) => (
              <CountInput key={i} id={`star-${i + 1}`} label={`${i + 1}`} value={v} onChange={(x) => setStars(stars.map((s, j) => (j === i ? x : s)))} />
            ))}
          </div>
        </form>
        <div className="grid content-start gap-4" aria-live="polite">
          {c ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="card border-accent/40 bg-accent-soft p-5">
                  <p className="text-sm font-medium text-accent">CSAT</p>
                  <p className="num mt-1 text-3xl tracking-tight">{pct(c.score)}</p>
                </div>
                <div className="card p-5">
                  <p className="text-sm text-muted">95% range</p>
                  <p className="num mt-1 text-3xl tracking-tight">{pct(c.interval.low, 0)} to {pct(c.interval.high, 0)}</p>
                </div>
              </div>
              <p className="text-muted">
                {c.satisfied} of {c.total} answers were a 4 or 5. With this many answers your underlying CSAT is probably between {pct(c.interval.low)} and {pct(c.interval.high)}. The average rating is {c.average.toFixed(2)} out of 5.
              </p>
            </>
          ) : (
            <p className="card p-5 text-muted">Enter at least one answer.</p>
          )}
          <p className="text-sm text-muted">CSAT = answers rated 4 or 5 ÷ all answers × 100. The range is a Wilson score interval, which stays honest with small samples.</p>
        </div>
      </section>

      <section aria-labelledby="nps" className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <form className="card grid content-start gap-4 p-5 sm:p-6" onSubmit={(e) => e.preventDefault()}>
          <h2 id="nps" className="font-display text-2xl">NPS</h2>
          <p className="text-sm text-muted">Answers to &ldquo;How likely are you to recommend us?&rdquo; on a 0 to 10 scale, grouped.</p>
          <div className="grid grid-cols-3 gap-2">
            <CountInput id="promoters" label="Promoters (9-10)" value={promoters} onChange={setPromoters} />
            <CountInput id="passives" label="Passives (7-8)" value={passives} onChange={setPassives} />
            <CountInput id="detractors" label="Detractors (0-6)" value={detractors} onChange={setDetractors} />
          </div>
        </form>
        <div className="grid content-start gap-4" aria-live="polite">
          {p ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="card border-accent/40 bg-accent-soft p-5">
                  <p className="text-sm font-medium text-accent">NPS</p>
                  <p className="num mt-1 text-3xl tracking-tight">{p.score > 0 ? "+" : ""}{p.score.toFixed(0)}</p>
                </div>
                <div className="card p-5">
                  <p className="text-sm text-muted">Margin of error</p>
                  <p className="num mt-1 text-3xl tracking-tight">± {p.margin.toFixed(1)}</p>
                </div>
              </div>
              <p className="text-muted">
                {pct(p.promoterShare, 0)} promoters minus {pct(p.detractorShare, 0)} detractors from {p.total} answers gives {p.score.toFixed(0)}. A change smaller than about {p.margin.toFixed(0)} points between two surveys this size could be chance.
              </p>
            </>
          ) : (
            <p className="card p-5 text-muted">Enter at least one answer.</p>
          )}
          <p className="text-sm text-muted">NPS = % promoters − % detractors, from −100 to +100. The margin treats each answer as +1, 0 or −1 and takes 1.96 standard errors.</p>
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="font-display text-2xl">How many answers do you need?</h2>
        <p className="max-w-3xl text-muted">
          For a share such as CSAT, these are the answers needed for a given margin of error at 95% confidence, in the worst case of a 50/50 split. Scores near 90% need fewer.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] max-w-xl border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Margin of error</th>
                <th scope="col" className="py-2 font-medium">Answers needed</th>
              </tr>
            </thead>
            <tbody className="num">
              {[0.1, 0.05, 0.03, 0.02].map((m) => (
                <tr key={m} className="border-b border-line">
                  <th scope="row" className="py-2 pr-4 font-sans font-medium">± {m * 100} points</th>
                  <td className="py-2">{responsesForMargin(m)?.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="max-w-3xl text-sm text-muted">
          Margins only cover chance. They can&rsquo;t fix who chooses to answer: if mostly delighted or furious customers reply, the score leans their way however many answers you collect.
        </p>
      </section>
    </div>
  );
}
