export default function SearchForm({ helpSlug, q = "", autoFocus = false }: { helpSlug: string; q?: string; autoFocus?: boolean }) {
  return (
    <form action={`/help/${helpSlug}`} role="search" className="flex gap-2">
      <label htmlFor="q" className="sr-only">Search the help center</label>
      <input id="q" name="q" type="search" defaultValue={q} placeholder="Search for answers" autoFocus={autoFocus} maxLength={200} className="field min-w-0 flex-1" />
      <button className="btn btn-primary">Search</button>
    </form>
  );
}
