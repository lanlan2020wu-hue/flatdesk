// Clerk is turned on by its keys. Without them (local development only),
// DEV_AUTH=1 signs everyone in as a fixed demo agent so the app can be run
// before the Clerk project exists.
export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export const devAuthEnabled = !clerkEnabled && process.env.DEV_AUTH === "1" && process.env.NODE_ENV !== "production";
