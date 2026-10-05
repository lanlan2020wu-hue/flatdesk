// Free customer service reply templates (/free-tools/customer-service-reply-templates).
// Written to be used as they are: plain words, one ask per reply, no
// "we apologize for any inconvenience". [Brackets] are the parts to fill in.

export type ReplyTemplate = { id: string; title: string; when: string; body: string };
export type TemplateGroup = { id: string; name: string; templates: ReplyTemplate[] };

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    id: "first-reply",
    name: "First replies",
    templates: [
      {
        id: "received-will-reply",
        title: "We got it, here's when you'll hear back",
        when: "You can't answer yet and the customer would otherwise wonder if anyone saw the message.",
        body: `Hi [name],

Thanks for writing in. I've read your message about [short summary], and I'm looking into it now.

I'll get back to you by [day and time]. If anything changes before then, just reply here and it will come straight to me.

[your name]`,
      },
      {
        id: "need-more-details",
        title: "Asking for the details you need",
        when: "You can't help without more information. Ask for everything at once so it takes one round trip, not three.",
        body: `Hi [name],

I'd like to sort this out for you, and I need a few details first:

1. [the first thing you need, e.g. the email on the account]
2. [the second thing, e.g. roughly when it happened]
3. [a screenshot of the error, if you can]

As soon as I have those I'll take it from there.

[your name]`,
      },
      {
        id: "wrong-team",
        title: "Pointing them to the right place",
        when: "The question belongs to another team or another company.",
        body: `Hi [name],

Thanks for reaching out. [Team or company] handles [topic], so they'll be able to help much faster than I can. You can reach them at [contact or link].

I've [forwarded your message / added a note] so you won't need to explain it all again. If they don't get back to you by [day], reply here and I'll chase it.

[your name]`,
      },
    ],
  },
  {
    id: "problems",
    name: "Bugs and outages",
    templates: [
      {
        id: "bug-confirmed",
        title: "Confirming a bug",
        when: "You've reproduced the problem and it's with the engineering team.",
        body: `Hi [name],

You're right, this is a bug on our side, and thanks for the clear report. I've reproduced it and passed it to our engineers with your details.

In the meantime, [workaround, if there is one].

I can't promise a date for the fix yet, but I'll write to you here as soon as it's out.

[your name]`,
      },
      {
        id: "cannot-reproduce",
        title: "We can't reproduce it",
        when: "You tried and everything works on your side.",
        body: `Hi [name],

I tried to recreate this [on the same browser / with the same steps] and it worked as expected for me, so something about your setup must be different.

Could you try [one simple thing, e.g. a private browser window], and if it still happens, send me [a screenshot / the exact steps / the time it happened]? That will tell me where to look.

[your name]`,
      },
      {
        id: "outage",
        title: "Known outage",
        when: "Something is down for everyone and the messages are piling up.",
        body: `Hi [name],

Thanks for letting us know. [Feature] is down for all customers right now, and our team is working on it. Your data is safe.

You can follow updates at [status page link]. I'll also reply here once it's fixed, so you don't need to keep checking.

Sorry for the disruption to your day.

[your name]`,
      },
      {
        id: "bug-fixed",
        title: "The fix is out",
        when: "Closing the loop on a bug the customer reported.",
        body: `Hi [name],

Good news: the fix for [the problem] is now live. You may need to [refresh the page / update the app] to see it.

Thanks again for reporting it. Your report is why it got fixed. If you still see the problem, reply here and I'll reopen this.

[your name]`,
      },
    ],
  },
  {
    id: "billing",
    name: "Billing and refunds",
    templates: [
      {
        id: "refund-approved",
        title: "Refund approved",
        when: "You're giving the money back.",
        body: `Hi [name],

I've refunded [amount] to the [card ending in 1234 / original payment method]. Banks usually take [number] business days to show it, depending on your bank.

Here's the receipt for your records: [link].

[your name]`,
      },
      {
        id: "refund-declined",
        title: "Refund declined, with an alternative",
        when: "Policy says no. Say so plainly, explain why once, and offer what you can do.",
        body: `Hi [name],

I looked into this carefully. I can't refund [the charge] because [the reason in one sentence, e.g. the plan renewed 45 days ago and refunds cover the first 30].

What I can do is [alternative: cancel so you're not charged again / move you to a cheaper plan / give a credit of X]. Just reply with which you'd prefer and I'll set it up today.

[your name]`,
      },
      {
        id: "double-charge",
        title: "Charged twice",
        when: "A duplicate charge. Act first, explain second.",
        body: `Hi [name],

You were charged twice on [date], and that shouldn't have happened. I've refunded the extra [amount] to your [card ending in 1234]. It should show within [number] business days.

I've also [checked your account / flagged it to our billing team] so it won't happen again next month.

[your name]`,
      },
      {
        id: "failed-payment",
        title: "Payment failed",
        when: "A card was declined and the account is at risk.",
        body: `Hi [name],

Your last payment for [product] didn't go through, most often because a card expired or was replaced.

You can update your card here: [link]. Nothing on your account changes before [date], so there's time.

If you meant to cancel, no action is needed and I can confirm it for you.

[your name]`,
      },
      {
        id: "price-increase-question",
        title: "Why did my bill go up?",
        when: "The customer sees a higher bill than they expected.",
        body: `Hi [name],

I've checked your last [two] invoices. The difference is [the cause, e.g. two new seats added on the 12th / usage over the included amount].

Here's the breakdown:
- [line item]: [amount]
- [line item]: [amount]

If that's not what you expected, I can [remove the seats / set a usage limit / walk you through it on a call].

[your name]`,
      },
    ],
  },
  {
    id: "accounts",
    name: "Accounts and access",
    templates: [
      {
        id: "password-reset",
        title: "Can't log in",
        when: "Login trouble. Most are solved by a reset link.",
        body: `Hi [name],

Let's get you back in. Please use this link to set a new password: [link]. It works for [time], so if it expires just ask me for a fresh one.

If the email doesn't arrive in a few minutes, check your spam folder for a message from [sender].

[your name]`,
      },
      {
        id: "verify-identity",
        title: "Verifying who they are",
        when: "A request that changes ownership, email or payment details.",
        body: `Hi [name],

Before I change [the account email / owner], I need to confirm it's really you. This protects your account from anyone pretending to be you.

Please reply from the email address on the account, or send me [the last 4 digits of the card on file / your invoice number].

[your name]`,
      },
      {
        id: "cancel-account",
        title: "Cancellation confirmed",
        when: "They asked to cancel. Make it easy, don't argue.",
        body: `Hi [name],

Done. Your [plan] is cancelled and you won't be charged again. You'll keep access until [date].

You can export your data any time before then here: [link].

If you're up for it, I'd like to know one thing we could have done better. Either way, thanks for trying us.

[your name]`,
      },
      {
        id: "data-deletion",
        title: "Deleting their data",
        when: "A request to delete personal data.",
        body: `Hi [name],

I've started deleting your personal data from [product]. It will be fully removed within [number] days, including from backups.

Some records, such as invoices, we're required to keep for [reason, e.g. tax law]. Those are kept only for that purpose.

I'll confirm here once it's done.

[your name]`,
      },
    ],
  },
  {
    id: "orders",
    name: "Orders and delivery",
    templates: [
      {
        id: "order-delayed",
        title: "Order is delayed",
        when: "You know about the delay before the customer has to ask again.",
        body: `Hi [name],

Your order [number] is running late: it's now expected on [date] instead of [original date]. The reason is [one honest sentence].

If that date doesn't work for you, I can [cancel for a full refund / switch to faster shipping at no cost]. Just tell me which.

[your name]`,
      },
      {
        id: "lost-package",
        title: "Package marked delivered but not received",
        when: "Tracking says delivered, the customer says no.",
        body: `Hi [name],

I'm sorry it hasn't turned up. Tracking shows it was delivered on [date] at [time] to [location, e.g. the front door].

Could you check with neighbours or your building's mailroom? These usually turn up within [a day or two].

If it hasn't arrived by [date], reply here and I'll [send a replacement / refund you], no need to explain again.

[your name]`,
      },
      {
        id: "return-instructions",
        title: "How to return an item",
        when: "A return that's within policy.",
        body: `Hi [name],

No problem. Here's how to return it:

1. Print this label: [link]
2. Pack the item in [any box / its original packaging]
3. Drop it at [carrier] by [date]

Your refund of [amount] goes out as soon as it reaches us, usually within [number] days of drop-off.

[your name]`,
      },
    ],
  },
  {
    id: "product",
    name: "Product questions",
    templates: [
      {
        id: "how-to",
        title: "Here's how to do it",
        when: "A how-to question with a help article that answers it.",
        body: `Hi [name],

Yes, you can. Here's how:

1. Go to [place]
2. Click [button]
3. [Final step]

There's a short guide with screenshots here: [link].

[your name]`,
      },
      {
        id: "feature-request",
        title: "Feature request: not yet",
        when: "Someone asks for something you don't do. Be honest about the odds.",
        body: `Hi [name],

Thanks for the suggestion. [Feature] isn't something we offer today, and I don't want to promise it's coming when I don't know.

I've added your request, with your use case, to the list our product team reviews. In the meantime, [workaround or alternative, if any].

[your name]`,
      },
      {
        id: "feature-shipped",
        title: "The thing you asked for is here",
        when: "Writing back to someone who asked for a feature that just shipped.",
        body: `Hi [name],

A while ago you asked us for [feature]. It's live today.

Here's how to use it: [link]. Thanks for asking. Requests like yours are how we decide what to build.

[your name]`,
      },
      {
        id: "no-is-the-answer",
        title: "Saying no clearly",
        when: "The answer is no and a vague reply would only cause another email.",
        body: `Hi [name],

I'll be direct so you can plan: [product] doesn't [do the thing], and it isn't on our plans.

If it's essential for you, [alternative product or approach] does it well. If not, here's the closest thing we have: [workaround].

[your name]`,
      },
    ],
  },
  {
    id: "hard-conversations",
    name: "Hard conversations",
    templates: [
      {
        id: "upset-customer",
        title: "Replying to an upset customer",
        when: "They're angry, with reason. Agree on what went wrong, then fix it.",
        body: `Hi [name],

You're right to be frustrated. [What went wrong, in plain words] isn't the experience you should have had, and I'm sorry.

Here's what I've done: [the fix or the next step, with a time].

I'll check in with you on [day] to make sure it's settled.

[your name]`,
      },
      {
        id: "abusive-message",
        title: "Setting a boundary",
        when: "The message crosses into abuse. Stay calm and keep the door open.",
        body: `Hi [name],

I want to help with [the issue], and I will. I'm not able to continue the conversation with the language in your last message, though.

If you can reply with [what you need from them], I'll pick this up straight away.

[your name]`,
      },
      {
        id: "escalating",
        title: "Escalating to a specialist",
        when: "You're handing over to someone more senior or more technical.",
        body: `Hi [name],

This needs someone with more [technical / billing] access than I have, so I've passed it to [name or team], with everything you've told me so you won't need to repeat it.

They'll reply in this same thread by [day and time].

[your name]`,
      },
      {
        id: "our-mistake",
        title: "We made a mistake",
        when: "The error was yours. Own it without hedging.",
        body: `Hi [name],

We got this wrong. [What happened, in one sentence], and that was our mistake, not anything you did.

I've [fixed it / refunded X / corrected your account], and [what changes so it won't happen again].

Thanks for your patience while we sorted it out.

[your name]`,
      },
    ],
  },
  {
    id: "closing",
    name: "Follow-ups and closing",
    templates: [
      {
        id: "no-response-follow-up",
        title: "Following up on a quiet ticket",
        when: "You're waiting on the customer and they've gone quiet.",
        body: `Hi [name],

Just checking in on [the issue]. Did [the suggested fix] work for you?

If I don't hear back, I'll close this on [date]. Replying any time after that reopens it, so nothing is lost.

[your name]`,
      },
      {
        id: "closing-solved",
        title: "Closing a solved ticket",
        when: "It's fixed and you want to end on a clear note.",
        body: `Hi [name],

Glad that's sorted. I'll mark this as solved.

If anything else comes up, just reply to this email and it will come back to us.

[your name]`,
      },
      {
        id: "satisfaction-ask",
        title: "Asking for feedback",
        when: "After a good resolution, if you run a satisfaction survey.",
        body: `Hi [name],

Thanks for your patience while we worked through [the issue]. If you have ten seconds, how did we do? [rating link]

Every answer is read by our team, including the critical ones.

[your name]`,
      },
    ],
  },
];

export const TEMPLATE_COUNT = TEMPLATE_GROUPS.reduce((n, g) => n + g.templates.length, 0);
