// The REST API reference shown at /developers. Kept next to nothing else so
// the page and the routes in app/api/v1 are easy to check against each other.

export type Endpoint = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  params?: { name: string; about: string }[];
  example?: string; // request body
};

export const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/v1/me", summary: "The team and key name. Use it to test a connection." },
  {
    method: "GET",
    path: "/api/v1/tickets",
    summary: "Tickets, most recently changed first.",
    params: [
      { name: "status", about: "open, pending or closed" },
      { name: "updated_since", about: "only tickets changed after this time (ISO 8601), for polling" },
      { name: "customer_email", about: "only this customer's tickets" },
      { name: "tag", about: "only tickets with this tag" },
      { name: "limit", about: "1 to 100, default 50" },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/tickets",
    summary: "A new ticket from a customer, as if they had emailed. Your replies go to them by email. The AI answers it like any new email unless ai_answer is false.",
    params: [
      { name: "customer_email", about: "required" },
      { name: "subject", about: "required" },
      { name: "body", about: "required, the customer's message" },
      { name: "customer_name", about: "optional" },
      { name: "tags", about: "optional array; assignment rules apply" },
      { name: "ai_answer", about: "optional, default true" },
    ],
    example: `{
  "customer_email": "sam@example.com",
  "customer_name": "Sam Lee",
  "subject": "Order #1042 arrived damaged",
  "body": "The mug was broken when it arrived.",
  "tags": ["damaged"]
}`,
  },
  { method: "GET", path: "/api/v1/tickets/:number", summary: "One ticket with its whole conversation, internal notes included." },
  {
    method: "PATCH",
    path: "/api/v1/tickets/:number",
    summary: "Change the status, assignee or tags.",
    params: [
      { name: "status", about: "open, pending or closed" },
      { name: "assignee_email", about: "someone on the team, or null to unassign" },
      { name: "tags", about: "replaces the tags" },
      { name: "add_tags", about: "adds to the tags" },
    ],
    example: `{ "status": "closed", "add_tags": ["refunded"] }`,
  },
  {
    method: "POST",
    path: "/api/v1/tickets/:number/messages",
    summary: "Reply to the customer (emailed to them), or add an internal note. A reply sets the ticket to pending unless you send a status.",
    params: [
      { name: "body", about: "required" },
      { name: "internal", about: "true for a note only the team sees" },
      { name: "author_email", about: "who it's from; defaults to whoever made the key" },
      { name: "status", about: "open, pending or closed" },
    ],
    example: `{ "body": "Sorry about that, Sam. A replacement is on its way.", "status": "closed" }`,
  },
  { method: "GET", path: "/api/v1/customers?email=", summary: "A customer, their fields, and their tickets." },
];

export const WEBHOOK_EXAMPLE = `{
  "event": "ticket.created",
  "text": "New ticket for the team: #1042 Order #1042 arrived damaged from Sam Lee (sam@example.com) by email.",
  "needsTeam": true,
  "reason": null,
  "ticket": {
    "number": 1042,
    "subject": "Order #1042 arrived damaged",
    "channel": "email",
    "status": "open",
    "url": "https://flatdesk.app/app/tickets/1042",
    "customer": { "name": "Sam Lee", "email": "sam@example.com" },
    "assignee": null
  },
  "sentAt": "2026-10-06T09:14:00.000Z"
}`;
