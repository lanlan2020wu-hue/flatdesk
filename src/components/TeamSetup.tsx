"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateOrganization, OrganizationList, useOrganizationList, useUser } from "@clerk/nextjs";
import { teamNameFromEmail } from "@/lib/team-name";

// Nearly everyone arriving here has just signed up and has no team to join, so
// they get one field, prefilled from their email, instead of a join list that
// is empty beside a create form. Anyone with an invitation, a suggested team
// for their domain, or an existing membership still gets Clerk's list.
export default function TeamSetup() {
  const router = useRouter();
  const { user, isLoaded: userLoaded } = useUser();
  const { isLoaded, createOrganization, setActive, userMemberships, userInvitations, userSuggestions } = useOrganizationList({
    userMemberships: true,
    userInvitations: true,
    userSuggestions: true,
  });
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "creating" | "error">("idle");
  const [message, setMessage] = useState("");

  const listsLoading = !isLoaded || !userLoaded || userMemberships.isLoading || userInvitations.isLoading || userSuggestions.isLoading;
  if (listsLoading) return <p className="text-sm text-muted" role="status">Loading…</p>;

  const hasSomewhereToJoin = Boolean(userMemberships.count || userInvitations.count || userSuggestions.count);
  if (hasSomewhereToJoin) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/app" afterCreateOrganizationUrl="/app/welcome" />
        {/* Invites happen on the next screen, alongside importing and connecting email. */}
        <CreateOrganization afterCreateOrganizationUrl="/app/welcome" skipInvitationScreen />
      </div>
    );
  }

  const value = name ?? teamNameFromEmail(user?.primaryEmailAddress?.emailAddress);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || !createOrganization || !setActive) return;
    setState("creating");
    try {
      const org = await createOrganization({ name: trimmed });
      await setActive({ organization: org.id });
      router.push("/app/welcome");
    } catch (err) {
      setState("error");
      const clerkMessage = (err as { errors?: { longMessage?: string; message?: string }[] }).errors?.[0];
      setMessage(clerkMessage?.longMessage ?? clerkMessage?.message ?? "We couldn't create the team. Please try again.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      <label className="grid gap-1.5 text-sm font-medium" htmlFor="team-name">
        Team name
        <input
          id="team-name"
          name="name"
          required
          autoFocus
          autoComplete="organization"
          placeholder="Your company"
          value={value}
          onChange={(e) => setName(e.target.value)}
          className="field font-normal"
        />
        <span className="font-normal text-muted">This is usually your company name. You can change it later in Settings.</span>
      </label>
      <button type="submit" disabled={state === "creating" || !value.trim()} className="btn btn-primary w-max">
        {state === "creating" ? "Creating your team…" : "Continue"}
      </button>
      {state === "error" && <p className="text-sm text-warn" role="alert">{message}</p>}
    </form>
  );
}
