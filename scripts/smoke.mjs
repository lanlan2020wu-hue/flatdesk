// Quick launch-day check of a deployed site: node scripts/smoke.mjs [url]
const base = (process.argv[2] || "https://flatdesk.app").replace(/\/$/, "");
let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const t0 = Date.now();
const res = await fetch(`${base}/api/health`).catch(() => null);
const h = res && res.ok ? await res.json() : null;
check(Boolean(h), "health endpoint answers", `${Date.now() - t0}ms`);
if (h) {
  check(h.database === "ok" && h.tables, "database connected, tables exist");
  check(h.signIn && h.signInMode === "live", "sign-in on live Clerk keys", String(h.signInMode));
  check(h.billing === "live", "Stripe on live keys", String(h.billing));
  check(h.email, "email keys and inbound domain set");
  check(h.ai, "AI key set");
  check(h.cron, "cron secret set");
  check(h.inboundWebhook, "inbound webhook secret set");
  check(h.importKey, "import secret set");
  check(h.site === base, "site URL matches", String(h.site));
  console.log(`info error alerts: ${h.errorAlerts ? "on" : "off"}, commit ${h.commit}`);
}

for (const path of ["/", "/pricing", "/sign-up", "/sign-in", "/features", "/terms", "/privacy", "/security", "/widget.js", "/robots.txt", "/sitemap.xml"]) {
  const t = Date.now();
  const r = await fetch(base + path, { redirect: "manual" }).catch(() => null);
  const ms = Date.now() - t;
  check(Boolean(r && r.status === 200), `GET ${path}`, r ? `${r.status}, ${ms}ms` : "no answer");
}

const cron = await fetch(`${base}/api/cron/daily`).catch(() => null);
check(cron?.status === 401, "cron rejects calls without the secret", String(cron?.status));

process.exit(failed ? 1 : 0);
