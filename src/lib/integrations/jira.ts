// Escalate a ticket to Jira: an agent turns it into an issue in the team's
// Jira Cloud project, with the customer's words and a link back. The ticket
// then shows the issue and its live status, so support knows when it's fixed.
//
// Teams connect with their Atlassian site, an account email and an API token
// (id.atlassian.com, Security, API tokens), plus the project and issue type
// new issues go into. Issues are created as that account.

const TIMEOUT_MS = 8000;

export class JiraError extends Error {}

export type JiraCreds = { site: string; email: string; token: string; project: string; issueType: string };
export type JiraIssue = { key: string; url: string; summary: string; status: string; done: boolean };

// "acme", "acme.atlassian.net" or a link into it all mean acme.atlassian.net.
// Only Atlassian Cloud sites, since the server sends the token there.
export function jiraSite(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]{0,60}$/.test(s)) s = `${s}.atlassian.net`;
  return /^[a-z0-9][a-z0-9-]{0,60}\.atlassian\.net$/.test(s) ? s : null;
}

export const projectKey = (raw: string) => {
  const k = raw.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,49}$/.test(k) ? k : null;
};

async function call<T>(c: Pick<JiraCreds, "site" | "email" | "token">, path: string, fetcher: typeof fetch, body?: unknown): Promise<T> {
  const res = await fetcher(`https://${c.site}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Basic ${Buffer.from(`${c.email}:${c.token}`).toString("base64")}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new JiraError("Jira didn't accept the email and API token.");
  if (res.status === 403) throw new JiraError("That Jira account isn't allowed to do this. It needs to browse the project and create issues in it.");
  if (res.status === 404) throw new JiraError("Jira couldn't find that. Check the site and project key.");
  if (res.status === 400) {
    const err = (await res.json().catch(() => null)) as { errorMessages?: string[]; errors?: Record<string, string> } | null;
    const msg = err?.errorMessages?.[0] ?? Object.values(err?.errors ?? {})[0];
    throw new JiraError(msg ? `Jira said: ${msg}` : "Jira didn't accept the request.");
  }
  if (!res.ok) throw new JiraError(`Jira answered ${res.status}.`);
  return (await res.json()) as T;
}

type Project = { key: string; name: string; issueTypes?: { name: string; subtask?: boolean }[] };

// Checks the account can see the project and that the issue type exists in
// it. Returns the project's name and the issue type as Jira spells it.
export async function verifyJira(c: JiraCreds, fetcher: typeof fetch = fetch): Promise<{ project: string; issueType: string }> {
  await call(c, "/rest/api/3/myself", fetcher);
  const p = await call<Project>(c, `/rest/api/3/project/${encodeURIComponent(c.project)}`, fetcher);
  const types = (p.issueTypes ?? []).filter((t) => !t.subtask);
  const match = types.find((t) => t.name.toLowerCase() === c.issueType.toLowerCase());
  if (!match) throw new JiraError(`The ${p.key} project has no issue type called ${c.issueType}. It has: ${types.map((t) => t.name).join(", ") || "none"}.`);
  return { project: `${p.name} (${p.key})`, issueType: match.name };
}

// Jira's rich text format (ADF): one paragraph per block of text, then a link back.
export function description(body: string, ticketUrl: string, ticketLabel: string) {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p.slice(0, 5000) }] }));
  return {
    type: "doc",
    version: 1,
    content: [
      ...paragraphs,
      { type: "paragraph", content: [{ type: "text", text: `From Flatdesk ${ticketLabel}`, marks: [{ type: "link", attrs: { href: ticketUrl } }] }] },
    ],
  };
}

export async function createJiraIssue(
  c: JiraCreds,
  input: { summary: string; body: string; ticketUrl: string; ticketLabel: string },
  fetcher: typeof fetch = fetch,
): Promise<{ key: string; url: string }> {
  const created = await call<{ key: string }>(c, "/rest/api/3/issue", fetcher, {
    fields: {
      project: { key: c.project },
      issuetype: { name: c.issueType },
      summary: input.summary.replace(/\s+/g, " ").trim().slice(0, 250),
      description: description(input.body, input.ticketUrl, input.ticketLabel),
      labels: ["flatdesk"],
    },
  });
  return { key: created.key, url: `https://${c.site}/browse/${created.key}` };
}

export async function jiraIssues(c: JiraCreds, keys: string[], fetcher: typeof fetch = fetch): Promise<JiraIssue[]> {
  const valid = keys.filter((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k)).slice(0, 10);
  return Promise.all(
    valid.map(async (key) => {
      // A deleted or moved issue still shows, so the link isn't lost.
      const i = await call<{ key: string; fields: { summary: string; status: { name: string; statusCategory?: { key: string } } } }>(
        c,
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`,
        fetcher,
      ).catch(() => null);
      if (!i) return { key, url: `https://${c.site}/browse/${key}`, summary: "", status: "Couldn't load", done: false };
      return {
        key: i.key,
        url: `https://${c.site}/browse/${i.key}`,
        summary: i.fields.summary,
        status: i.fields.status.name,
        done: i.fields.status.statusCategory?.key === "done",
      };
    }),
  );
}
