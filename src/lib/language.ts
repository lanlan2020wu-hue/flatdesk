// Languages for auto-translate, and a free guess at which one a message is in.
// The guess decides whether a message is worth translating at all, so English
// "thanks!" never costs an AI call. Kept free of server imports: the composer
// uses the labels.

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "el", label: "Greek" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "th", label: "Thai" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const isLanguage = (v: unknown): v is LanguageCode => LANGUAGES.some((l) => l.code === v);
export const languageLabel = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code)?.label ?? code ?? "";

// Common short words that mostly belong to one language.
const WORDS: Partial<Record<LanguageCode, string[]>> = {
  en: ["the", "and", "is", "you", "my", "to", "it", "of", "for", "have", "with", "this", "not", "can", "please", "thanks", "order", "was", "what", "how", "i'm", "your", "would", "help", "hi", "hello"],
  es: ["el", "la", "los", "las", "que", "de", "y", "es", "por", "para", "con", "mi", "no", "una", "pedido", "hola", "gracias", "está", "como", "pero", "necesito", "tengo", "puedo", "cuando"],
  fr: ["le", "la", "les", "et", "est", "je", "vous", "pour", "pas", "une", "des", "mon", "ma", "avec", "commande", "bonjour", "merci", "que", "qui", "mais", "c'est", "j'ai", "sur"],
  de: ["der", "die", "das", "und", "ist", "ich", "nicht", "mit", "für", "ein", "eine", "mein", "meine", "bestellung", "hallo", "danke", "bitte", "wie", "aber", "habe", "sie", "auf", "noch"],
  pt: ["o", "os", "as", "que", "de", "e", "é", "não", "um", "uma", "para", "com", "meu", "minha", "pedido", "olá", "obrigado", "obrigada", "mas", "você", "está", "tenho", "como"],
  it: ["il", "lo", "la", "gli", "che", "di", "e", "è", "non", "un", "una", "per", "con", "mio", "mia", "ordine", "ciao", "grazie", "ma", "sono", "ho", "come", "buongiorno"],
  nl: ["de", "het", "een", "en", "is", "ik", "niet", "met", "voor", "mijn", "bestelling", "hallo", "bedankt", "dank", "maar", "van", "wat", "hoe", "heb", "zijn", "graag"],
  sv: ["och", "är", "jag", "inte", "med", "för", "en", "ett", "min", "mitt", "beställning", "hej", "tack", "men", "det", "som", "har", "hur", "vad"],
  pl: ["i", "jest", "nie", "się", "na", "do", "mój", "moje", "zamówienie", "dzień", "dobry", "dziękuję", "ale", "jak", "co", "mam", "proszę", "czy", "że"],
  tr: ["ve", "bir", "bu", "için", "ile", "değil", "benim", "sipariş", "siparişim", "merhaba", "teşekkürler", "ama", "nasıl", "ne", "var", "yok", "lütfen", "mı", "mi"],
  vi: ["và", "là", "của", "tôi", "không", "có", "cho", "với", "đơn", "hàng", "xin", "chào", "cảm", "ơn", "nhưng", "được", "này"],
  id: ["dan", "yang", "saya", "tidak", "ini", "untuk", "dengan", "pesanan", "halo", "terima", "kasih", "tapi", "bagaimana", "apa", "ada", "sudah", "belum", "mohon"],
};

// Scripts that name a language on their own.
const SCRIPTS: [RegExp, LanguageCode][] = [
  [/[가-힯]/g, "ko"],
  [/[぀-ヿ]/g, "ja"],
  [/[一-鿿]/g, "zh"],
  [/[؀-ۿ]/g, "ar"],
  [/[֐-׿]/g, "he"],
  [/[ऀ-ॿ]/g, "hi"],
  [/[฀-๿]/g, "th"],
  [/[Ͱ-Ͽ]/g, "el"],
  [/[Ѐ-ӿ]/g, "ru"],
];

// The language a message is most likely in, or null when it's too short or
// too mixed to tell. Quoted email history (lines starting with ">") is left out.
export function guessLanguage(raw: string): LanguageCode | null {
  const text = raw
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join(" ")
    .replace(/https?:\/\/\S+|\S+@\S+/g, " ")
    .slice(0, 4000);
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 8) return null;
  for (const [re, code] of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    if (n / letters > 0.3) {
      // Japanese mixes kana with Chinese characters; Ukrainian has its own letters.
      if (code === "zh" && /[぀-ヿ]/.test(text)) return "ja";
      if (code === "ru" && /[іїєґ]/i.test(text)) return "uk";
      return code;
    }
  }
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 3) return null;
  const scores = (Object.keys(WORDS) as LanguageCode[]).map((code) => {
    const list = new Set(WORDS[code]);
    return { code, n: words.filter((w) => list.has(w)).length };
  });
  scores.sort((a, b) => b.n - a.n);
  const [best, next] = scores;
  // Needs a few hits and a clear lead: "no" or "de" alone says little.
  if (best.n < 2 || best.n < Math.max(2, words.length * 0.08) || best.n <= next.n * 1.3) return null;
  return best.code;
}

// Worth translating for a team that works in `team`.
export function isForeign(text: string, team: string): LanguageCode | null {
  const guess = guessLanguage(text);
  return guess && guess !== team ? guess : null;
}
