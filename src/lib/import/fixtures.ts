// Recorded-shape API responses for each help desk, used by the import tests
// and by scripts/demo-import.ts to try the import screens without an account.
import type { FetchLike } from "./http";
import type { SourceId } from "./types";

export type Routes = Record<string, unknown>;

// Answers GETs by path + query relative to the API base; anything else is a 404.
export function fakeApi(base: string, routes: Routes): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ access_token: "test-token" });
    const rel = url.startsWith(base) ? decodeURIComponent(url.slice(base.length)) : url;
    calls.push(rel);
    if (!(rel in routes)) return new Response("not found", { status: 404 });
    return Response.json(routes[rel]);
  };
  return Object.assign(f, { calls });
}

const zendeskUsers = [
  { id: 600, name: "Maria Chen", email: "maria@northwind.io", role: "end-user" },
  { id: 10, name: "Ana", email: "ana@acme.com", role: "admin" },
  { id: 11, name: "Bo", email: "bo@acme.com", role: "agent" },
];
const zendeskRoutes: Routes = {
  "users/me.json": { user: { id: 10, role: "admin" } },
  "users.json?role[]=agent&role[]=admin&page[size]=100": {
    users: [
      { id: 10, name: "Ana", email: "Ana@acme.com", role: "admin", active: true },
      { id: 11, name: "Bo", email: "bo@acme.com", role: "agent", active: true },
    ],
    meta: { has_more: false },
  },
  "groups.json?page[size]=100": { groups: [{ id: 100, name: "Billing" }], meta: { has_more: false } },
  "ticket_fields.json?page[size]=100": {
    ticket_fields: [{ id: 200, title: "Plan", custom_field_options: [{ name: "Pro plan", value: "pro" }] }],
    meta: { has_more: false },
  },
  "tags.json?page[size]=100": { tags: [{ name: "Billing Issue", count: 3 }, { name: "vip", count: 1 }], meta: { has_more: false } },
  "macros.json?page[size]=100": {
    macros: [
      {
        id: 300,
        title: "Refund issued",
        active: true,
        actions: [
          { field: "comment_value", value: ["channel:all", "I've refunded you."] },
          { field: "current_tags", value: "refund billing" },
          { field: "status", value: "solved" },
          { field: "priority", value: "high" },
          { field: "group_id", value: 100 },
        ],
      },
      { id: 301, title: "Old greeting", active: false, actions: [{ field: "comment_value", value: "Hi" }] },
    ],
    meta: { has_more: false },
  },
  "triggers.json?page[size]=100": {
    triggers: [
      {
        id: 400,
        title: "VIPs go to Ana",
        active: true,
        conditions: { all: [{ field: "current_tags", operator: "includes", value: "vip" }, { field: "update_type", operator: "is", value: "Create" }], any: [] },
        actions: [{ field: "assignee_id", value: "10" }],
      },
      {
        id: 401,
        title: "Refunds go to Bo",
        active: true,
        conditions: { all: [{ field: "current_tags", operator: "includes", value: "refund" }], any: [] },
        actions: [{ field: "assignee_id", value: "11" }],
      },
      {
        id: 402,
        title: "Notify requester",
        active: true,
        conditions: { all: [{ field: "status", operator: "is", value: "new" }], any: [] },
        actions: [{ field: "notification_user", value: ["requester_id", "We got it", "Thanks"] }],
      },
    ],
    meta: { has_more: false },
  },
  "automations.json?page[size]=100": { automations: [], meta: { has_more: false } },
  "organizations.json?page[size]=100": { organizations: [{ id: 500, name: "Northwind" }], meta: { has_more: false } },
  "users.json?role=end-user&page[size]=100": {
    users: [{ id: 600, name: "Maria Chen", email: "maria@northwind.io", role: "end-user", organization_id: 500, phone: "+1 555 0100", user_fields: { plan: "pro" } }],
    meta: { has_more: true },
    links: { next: "https://acme.zendesk.com/api/v2/users.json?role=end-user&page[size]=100&page[after]=abc" },
  },
  "users.json?role=end-user&page[size]=100&page[after]=abc": {
    users: [{ id: 601, name: "Phone Only", email: null, role: "end-user" }],
    meta: { has_more: false },
  },
  "incremental/tickets/cursor.json?start_time=0": {
    tickets: [
      {
        id: 4521,
        subject: "Charged twice",
        status: "solved",
        priority: "high",
        group_id: 100,
        requester_id: 600,
        assignee_id: 10,
        tags: ["Billing Issue", "vip"],
        custom_fields: [{ id: 200, value: "pro" }],
        via: { channel: "email" },
        created_at: "2024-01-02T10:00:00Z",
        updated_at: "2024-01-03T10:00:00Z",
      },
      { id: 4522, subject: "Spam", status: "deleted", requester_id: 600, created_at: "2024-01-02T10:00:00Z", updated_at: "2024-01-02T10:00:00Z" },
      { id: 1, subject: "Phone call", status: "open", requester_id: 601, assignee_id: 11, tags: [], via: { channel: "voice" }, created_at: "2023-05-01T10:00:00Z", updated_at: "2023-05-01T10:00:00Z" },
    ],
    end_of_stream: true,
  },
  "tickets/4521/comments.json?page[size]=100&include=users": {
    comments: [
      {
        id: 1,
        author_id: 600,
        plain_body: "I was charged twice.",
        public: true,
        created_at: "2024-01-02T10:00:00Z",
        attachments: [{ file_name: "statement.png", content_url: "https://acme.zendesk.com/attachments/token/1" }],
      },
      { id: 2, author_id: 11, plain_body: "Checking with finance.", public: false, created_at: "2024-01-02T11:00:00Z", attachments: [] },
      { id: 3, author_id: 10, plain_body: "Refunded, sorry!", public: true, created_at: "2024-01-02T12:00:00Z", attachments: [] },
    ],
    users: zendeskUsers,
    meta: { has_more: false },
  },
  "tickets/1/comments.json?page[size]=100&include=users": {
    comments: [{ id: 9, author_id: 601, plain_body: "Call me back", public: true, created_at: "2023-05-01T10:00:00Z", attachments: [] }],
    users: [{ id: 601, name: "Phone Only", role: "end-user" }],
    meta: { has_more: false },
  },
};

const intercomRoutes: Routes = {
  me: { id: "1", type: "admin" },
  admins: { admins: [{ id: "7", type: "admin", name: "Ana", email: "ana@acme.com" }] },
  teams: { teams: [{ id: "t1", name: "Support" }] },
  "data_attributes?model=conversation": { data: [{ id: 5, name: "order_id", label: "Order ID" }] },
  tags: { data: [{ id: "g1", name: "Refund Request" }] },
  "macros?per_page=50": { data: [{ id: "m1", name: "Greeting", body: "<p>Hi {{first_name}}, thanks!</p>" }], pages: {} },
  "companies?per_page=50&page=1": { data: [], pages: { total_pages: 1 } },
  "contacts?per_page=150": {
    data: [
      { id: "c1", role: "user", email: "lee@shop.co", name: "Lee", phone: null, custom_attributes: { tier: "gold" } },
      { id: "c2", role: "lead", email: null, name: null },
    ],
    pages: {},
  },
  "conversations?per_page=50": { conversations: [{ id: "900" }, { id: "901" }], pages: {} },
  "conversations/900?display_as=plaintext": {
    id: "900",
    state: "snoozed",
    created_at: 1_700_000_000,
    updated_at: 1_700_000_500,
    admin_assignee_id: 7,
    team_assignee_id: "t1",
    tags: { tags: [{ name: "Refund Request" }] },
    custom_attributes: { "Order ID": "A-17" },
    contacts: { contacts: [{ id: "c1" }] },
    source: { type: "conversation", author: { type: "user", id: "c1", name: "Lee", email: "lee@shop.co" }, body: "<p>Where is my refund?</p>", attachments: [] },
    conversation_parts: {
      total_count: 3,
      conversation_parts: [
        { id: "p1", part_type: "assignment", body: null, created_at: 1_700_000_100, author: { type: "bot", id: "b" } },
        { id: "p2", part_type: "comment", body: "It's on the way.", created_at: 1_700_000_200, author: { type: "admin", id: "7", name: "Ana", email: "ana@acme.com" } },
        { id: "p3", part_type: "note", body: "Refund sent in Stripe", created_at: 1_700_000_300, author: { type: "admin", id: "7" } },
      ],
    },
  },
  "conversations/901?display_as=plaintext": {
    id: "901",
    state: "closed",
    created_at: 1_700_001_000,
    updated_at: 1_700_001_000,
    contacts: { contacts: [{ id: "c2" }] },
    source: { type: "email", subject: "Hello", author: { type: "lead", id: "c2" }, body: "Hi there" },
    conversation_parts: { total_count: 0, conversation_parts: [] },
  },
};

const freshdeskTickets = "tickets?per_page=100&page=1&updated_since=1970-01-01T00:00:00Z&order_by=updated_at&order_type=asc&include=description,requester";
const freshdeskRoutes: Routes = {
  "agents/me": { id: 1 },
  "agents?per_page=100&page=1": [{ id: 1, contact: { name: "Ana", email: "ana@acme.com", active: true } }],
  "groups?per_page=100&page=1": [{ id: 2, name: "Tier 1" }],
  ticket_fields: [{ name: "cf_order", label: "Order number" }],
  canned_response_folders: [{ id: 3, name: "General" }],
  "canned_response_folders/3/responses?per_page=100&page=1": [{ id: 31, title: "Thanks", content: "Thanks for writing in!", content_html: "<p>Thanks for writing in!</p>" }],
  "scenario_automations?per_page=100&page=1": [
    { id: 41, name: "Escalate", actions: [{ name: "priority", value: 4 }, { name: "add_tag", value: ["urgent"] }, { name: "status", value: 3 }] },
  ],
  "automations/1/rules?per_page=100&page=1": [
    { id: 51, name: "Billing to Ana", active: true, conditions: [{ match_type: "all", properties: [{ field_name: "tag_names", operator: "in", value: ["billing"] }] }], actions: [{ field_name: "responder_id", value: 1 }] },
  ],
  "automations/3/rules?per_page=100&page=1": [],
  "automations/4/rules?per_page=100&page=1": [
    { id: 52, name: "Close stale", active: true, conditions: [{ match_type: "all", properties: [{ field_name: "hours_since_pending", operator: "greater_than", value: 72 }] }], actions: [{ field_name: "status", value: 5 }] },
  ],
  "companies?per_page=100&page=1": [{ id: 6, name: "Globex" }],
  "contacts?per_page=100&page=1": [{ id: 7, name: "Hank", email: "hank@globex.com", company_id: 6, custom_fields: { vip: true } }],
  [freshdeskTickets]: [
    {
      id: 81,
      subject: "Broken export",
      status: 6,
      priority: 3,
      source: 1,
      group_id: 2,
      requester_id: 7,
      responder_id: 1,
      tags: ["Export"],
      custom_fields: { cf_order: "PO-9" },
      description_text: "Export fails",
      created_at: "2025-02-01T09:00:00Z",
      updated_at: "2025-02-02T09:00:00Z",
      attachments: [],
    },
  ],
  "tickets/81/conversations?per_page=100&page=1": [
    { id: 811, body_text: "Looking into it", incoming: false, private: false, user_id: 1, created_at: "2025-02-01T10:00:00Z", attachments: [] },
    { id: 812, body_text: "Any news?", incoming: true, private: false, user_id: 7, created_at: "2025-02-02T09:00:00Z", attachments: [] },
  ],
};

const helpscoutRoutes: Routes = {
  "users/me": { id: 1 },
  "users?page=1": { _embedded: { users: [{ id: 1, firstName: "Ana", lastName: "", email: "ana@acme.com", role: "owner" }] }, page: { totalPages: 1 } },
  "mailboxes?page=1": { _embedded: { mailboxes: [{ id: 10, name: "Support" }] }, page: { totalPages: 1 } },
  "mailboxes/10/fields": { _embedded: { fields: [{ id: 20, name: "Plan" }] } },
  "tags?page=1": { _embedded: { tags: [{ id: 30, name: "bug" }] }, page: { totalPages: 1 } },
  "mailboxes/10/saved-replies": [{ id: 40, name: "Bug ack", preview: "Thanks for the rep..." }],
  "mailboxes/10/saved-replies/40": { id: 40, name: "Bug ack", text: "<p>Thanks for the report, {%customer.firstName%}.</p>" },
  "workflows?page=1": { _embedded: { workflows: [{ id: 50, mailboxId: 10, type: "automatic", status: "active", name: "Auto-tag bugs" }] }, page: { totalPages: 1 } },
  "customers?page=1": {
    _embedded: { customers: [{ id: 60, firstName: "Kim", lastName: "Lo", _embedded: { emails: [{ value: "kim@lo.dev" }, { value: "kim@work.dev" }], phones: [] } }] },
    page: { totalPages: 1 },
  },
  "conversations?status=all&embed=threads&sortField=createdAt&sortOrder=asc&page=1": {
    _embedded: {
      conversations: [
        {
          id: 70,
          number: 312,
          subject: "App crashes",
          status: "closed",
          mailboxId: 10,
          createdAt: "2025-03-01T08:00:00Z",
          closedAt: "2025-03-02T08:00:00Z",
          userUpdatedAt: "2025-03-02T08:00:00Z",
          primaryCustomer: { id: 60, email: "kim@lo.dev", first: "Kim", last: "Lo" },
          assignee: { id: 1, email: "ana@acme.com" },
          tags: [{ id: 30, tag: "bug" }],
          customFields: [{ id: 20, name: "Plan", value: "1", text: "Business" }],
          source: { type: "email" },
          _embedded: {
            threads: [
              { id: 3, type: "message", body: "<p>Fixed in 2.1</p>", createdBy: { id: 1, type: "user", email: "ana@acme.com", first: "Ana" }, createdAt: "2025-03-01T09:00:00Z" },
              { id: 4, type: "lineitem", action: { text: "Closed" }, createdAt: "2025-03-02T08:00:00Z" },
              { id: 2, type: "customer", body: "<p>It crashes on launch</p>", createdBy: { id: 60, type: "customer", email: "kim@lo.dev" }, createdAt: "2025-03-01T08:00:00Z" },
            ],
          },
        },
      ],
    },
    page: { totalPages: 1 },
  },
};

export const FIXTURES: Record<SourceId, { base: string; creds: Record<string, string>; routes: Routes }> = {
  zendesk: { base: "https://acme.zendesk.com/api/v2/", creds: { subdomain: "acme", email: "ana@acme.com", token: "t" }, routes: zendeskRoutes },
  intercom: { base: "https://api.intercom.io/", creds: { token: "tok" }, routes: intercomRoutes },
  freshdesk: { base: "https://acme.freshdesk.com/api/v2/", creds: { domain: "acme", apiKey: "k" }, routes: freshdeskRoutes },
  helpscout: { base: "https://api.helpscout.net/v2/", creds: { appId: "a", appSecret: "b" }, routes: helpscoutRoutes },
};
