// schema.org data for search engines and AI answer engines. "<" is escaped so
// no string in the data can close the script tag.
export default function JsonLd({ data }: { data: Record<string, unknown>[] }) {
  const graph = { "@context": "https://schema.org", "@graph": data };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, "\\u003c") }} />;
}
