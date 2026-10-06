import { helpWords } from "@/lib/help-i18n";

export default function SearchForm({ action, lang, keepLang, q = "", autoFocus = false }: { action: string; lang: string; keepLang: boolean; q?: string; autoFocus?: boolean }) {
  const w = helpWords(lang);
  return (
    <form action={action} role="search" className="flex gap-2">
      {keepLang && <input type="hidden" name="lang" value={lang} />}
      <label htmlFor="q" className="sr-only">{w.search}</label>
      <input id="q" name="q" type="search" defaultValue={q} placeholder={w.placeholder} autoFocus={autoFocus} maxLength={200} className="field min-w-0 flex-1" />
      <button className="btn btn-primary">{w.search}</button>
    </form>
  );
}
