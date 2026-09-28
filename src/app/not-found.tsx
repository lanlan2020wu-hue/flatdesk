import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto grid max-w-lg flex-1 content-center gap-5 px-4 py-20">
      <Logo />
      <p className="eyebrow">404</p>
      <h1 className="font-display text-4xl">This page doesn&apos;t exist</h1>
      <p className="text-muted">The link may be old, or the ticket may belong to another team.</p>
      <p className="flex flex-wrap gap-3">
        <Link href="/app/inbox" className="btn btn-primary">Go to the inbox</Link>
        <Link href="/" className="btn btn-secondary">Home page</Link>
      </p>
    </main>
  );
}
