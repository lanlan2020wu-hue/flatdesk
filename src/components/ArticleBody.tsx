import { parseArticle, type Inline } from "@/lib/help";

function Text({ content }: { content: Inline[] }) {
  return content.map((i, n) =>
    i.type === "bold" ? (
      <strong key={n} className="font-semibold">{i.text}</strong>
    ) : i.type === "link" ? (
      <a key={n} href={i.href} className="link text-accent" rel="nofollow noopener">{i.text}</a>
    ) : (
      i.text
    ),
  );
}

// A help center article, rendered from its stored text. See parseArticle().
export default function ArticleBody({ body }: { body: string }) {
  return (
    <div className="grid gap-4 leading-relaxed">
      {parseArticle(body).map((b, n) => {
        if (b.type === "heading")
          return b.level === 2 ? (
            <h2 key={n} className="mt-4 font-display text-2xl"><Text content={b.content} /></h2>
          ) : (
            <h3 key={n} className="mt-2 font-display text-xl"><Text content={b.content} /></h3>
          );
        if (b.type === "list") {
          const List = b.ordered ? "ol" : "ul";
          return (
            <List key={n} className={`grid gap-2 pl-6 ${b.ordered ? "list-decimal" : "list-disc"}`}>
              {b.items.map((item, i) => (
                <li key={i} className="pl-1"><Text content={item} /></li>
              ))}
            </List>
          );
        }
        return <p key={n}><Text content={b.content} /></p>;
      })}
    </div>
  );
}
