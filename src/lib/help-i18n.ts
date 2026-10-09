import { isLanguage, type LanguageCode } from "@/lib/language";

// The help center's own words (headings, buttons) in each language it can be
// offered in. Articles are translated separately (article_translations).

type Words = {
  help: string;
  heading: string;
  placeholder: string;
  search: string;
  all: string;
  more: string;
  seeAll: string; // followed by the count in brackets
  results: string; // followed by the search words
  nothing: string;
  empty: string;
  orChat: string; // "or chat with us", after nothing/empty
  stuck: string;
  chat: string;
  updated: string;
  untranslated: string; // followed by the original language's name
  language: string;
};

const W: Record<LanguageCode, Words> = {
  en: { help: "Help", heading: "How can we help?", placeholder: "Search for answers", search: "Search", all: "All articles", more: "More articles", seeAll: "See all", results: "Results for", nothing: "Nothing matched. Try fewer or different words", empty: "No articles yet", orChat: "or chat with us and we'll help.", stuck: "Still stuck?", chat: "Chat with us", updated: "Updated", untranslated: "This article isn't translated yet. Here it is in", language: "Language" },
  es: { help: "Ayuda", heading: "¿Cómo podemos ayudarte?", placeholder: "Busca respuestas", search: "Buscar", all: "Todos los artículos", more: "Más artículos", seeAll: "Ver todos", results: "Resultados para", nothing: "No hay coincidencias. Prueba con menos palabras o con otras", empty: "Aún no hay artículos", orChat: "o escríbenos por chat y te ayudamos.", stuck: "¿Sigues con dudas?", chat: "Chatea con nosotros", updated: "Actualizado", untranslated: "Este artículo aún no está traducido. Aquí está en", language: "Idioma" },
  fr: { help: "Aide", heading: "Comment pouvons-nous vous aider ?", placeholder: "Rechercher une réponse", search: "Rechercher", all: "Tous les articles", more: "Autres articles", seeAll: "Tout voir", results: "Résultats pour", nothing: "Aucun résultat. Essayez avec moins de mots ou d'autres mots", empty: "Aucun article pour l'instant", orChat: "ou discutez avec nous, nous vous aiderons.", stuck: "Toujours bloqué ?", chat: "Discuter avec nous", updated: "Mis à jour le", untranslated: "Cet article n'est pas encore traduit. Le voici en", language: "Langue" },
  de: { help: "Hilfe", heading: "Wie können wir helfen?", placeholder: "Antworten suchen", search: "Suchen", all: "Alle Artikel", more: "Weitere Artikel", seeAll: "Alle anzeigen", results: "Ergebnisse für", nothing: "Keine Treffer. Versuchen Sie weniger oder andere Wörter", empty: "Noch keine Artikel", orChat: "oder schreiben Sie uns im Chat, wir helfen gern.", stuck: "Noch Fragen?", chat: "Chat starten", updated: "Aktualisiert am", untranslated: "Dieser Artikel ist noch nicht übersetzt. Hier ist er auf", language: "Sprache" },
  pt: { help: "Ajuda", heading: "Como podemos ajudar?", placeholder: "Procure respostas", search: "Pesquisar", all: "Todos os artigos", more: "Mais artigos", seeAll: "Ver todos", results: "Resultados para", nothing: "Nada encontrado. Tente menos palavras ou outras", empty: "Ainda não há artigos", orChat: "ou fale conosco pelo chat e ajudamos você.", stuck: "Ainda com dúvidas?", chat: "Fale conosco", updated: "Atualizado em", untranslated: "Este artigo ainda não foi traduzido. Aqui está em", language: "Idioma" },
  it: { help: "Assistenza", heading: "Come possiamo aiutarti?", placeholder: "Cerca risposte", search: "Cerca", all: "Tutti gli articoli", more: "Altri articoli", seeAll: "Vedi tutti", results: "Risultati per", nothing: "Nessun risultato. Prova con meno parole o parole diverse", empty: "Ancora nessun articolo", orChat: "oppure scrivici in chat e ti aiutiamo.", stuck: "Hai ancora bisogno di aiuto?", chat: "Scrivici in chat", updated: "Aggiornato il", untranslated: "Questo articolo non è ancora tradotto. Eccolo in", language: "Lingua" },
  nl: { help: "Help", heading: "Waarmee kunnen we helpen?", placeholder: "Zoek naar antwoorden", search: "Zoeken", all: "Alle artikelen", more: "Meer artikelen", seeAll: "Alles bekijken", results: "Resultaten voor", nothing: "Niets gevonden. Probeer minder of andere woorden", empty: "Nog geen artikelen", orChat: "of chat met ons, dan helpen we je.", stuck: "Kom je er niet uit?", chat: "Chat met ons", updated: "Bijgewerkt op", untranslated: "Dit artikel is nog niet vertaald. Hier is het in het", language: "Taal" },
  sv: { help: "Hjälp", heading: "Hur kan vi hjälpa till?", placeholder: "Sök efter svar", search: "Sök", all: "Alla artiklar", more: "Fler artiklar", seeAll: "Visa alla", results: "Resultat för", nothing: "Inga träffar. Prova färre eller andra ord", empty: "Inga artiklar ännu", orChat: "eller chatta med oss så hjälper vi dig.", stuck: "Fortfarande fast?", chat: "Chatta med oss", updated: "Uppdaterad", untranslated: "Den här artikeln är inte översatt än. Här är den på", language: "Språk" },
  pl: { help: "Pomoc", heading: "Jak możemy pomóc?", placeholder: "Szukaj odpowiedzi", search: "Szukaj", all: "Wszystkie artykuły", more: "Więcej artykułów", seeAll: "Zobacz wszystkie", results: "Wyniki dla", nothing: "Brak wyników. Spróbuj mniejszej liczby słów lub innych słów", empty: "Brak artykułów", orChat: "albo napisz do nas na czacie, a pomożemy.", stuck: "Nadal potrzebujesz pomocy?", chat: "Napisz na czacie", updated: "Zaktualizowano", untranslated: "Ten artykuł nie jest jeszcze przetłumaczony. Oto wersja w języku:", language: "Język" },
  tr: { help: "Yardım", heading: "Size nasıl yardımcı olabiliriz?", placeholder: "Yanıt arayın", search: "Ara", all: "Tüm makaleler", more: "Diğer makaleler", seeAll: "Tümünü gör", results: "Arama sonuçları:", nothing: "Sonuç bulunamadı. Daha az ya da farklı kelimeler deneyin", empty: "Henüz makale yok", orChat: "ya da bizimle sohbet edin, yardımcı olalım.", stuck: "Hâlâ sorun mu var?", chat: "Bize yazın", updated: "Güncellendi", untranslated: "Bu makale henüz çevrilmedi. Orijinal dili:", language: "Dil" },
  vi: { help: "Trợ giúp", heading: "Chúng tôi có thể giúp gì?", placeholder: "Tìm câu trả lời", search: "Tìm kiếm", all: "Tất cả bài viết", more: "Bài viết khác", seeAll: "Xem tất cả", results: "Kết quả cho", nothing: "Không tìm thấy. Hãy thử ít từ hơn hoặc từ khác", empty: "Chưa có bài viết", orChat: "hoặc trò chuyện với chúng tôi để được hỗ trợ.", stuck: "Vẫn cần hỗ trợ?", chat: "Trò chuyện với chúng tôi", updated: "Cập nhật", untranslated: "Bài viết này chưa được dịch. Đây là bản tiếng", language: "Ngôn ngữ" },
  id: { help: "Bantuan", heading: "Ada yang bisa kami bantu?", placeholder: "Cari jawaban", search: "Cari", all: "Semua artikel", more: "Artikel lainnya", seeAll: "Lihat semua", results: "Hasil untuk", nothing: "Tidak ada yang cocok. Coba kata yang lebih sedikit atau berbeda", empty: "Belum ada artikel", orChat: "atau chat dengan kami, kami siap membantu.", stuck: "Masih butuh bantuan?", chat: "Chat dengan kami", updated: "Diperbarui", untranslated: "Artikel ini belum diterjemahkan. Ini versi bahasa", language: "Bahasa" },
  ru: { help: "Помощь", heading: "Чем мы можем помочь?", placeholder: "Поиск ответов", search: "Найти", all: "Все статьи", more: "Другие статьи", seeAll: "Показать все", results: "Результаты по запросу", nothing: "Ничего не найдено. Попробуйте меньше слов или другие слова", empty: "Статей пока нет", orChat: "или напишите нам в чат, и мы поможем.", stuck: "Остались вопросы?", chat: "Написать в чат", updated: "Обновлено", untranslated: "Эта статья ещё не переведена. Вот она на языке:", language: "Язык" },
  uk: { help: "Допомога", heading: "Чим ми можемо допомогти?", placeholder: "Пошук відповідей", search: "Знайти", all: "Усі статті", more: "Інші статті", seeAll: "Показати всі", results: "Результати за запитом", nothing: "Нічого не знайдено. Спробуйте менше слів або інші слова", empty: "Статей поки немає", orChat: "або напишіть нам у чат, і ми допоможемо.", stuck: "Залишилися питання?", chat: "Написати в чат", updated: "Оновлено", untranslated: "Цю статтю ще не перекладено. Ось вона мовою:", language: "Мова" },
  el: { help: "Βοήθεια", heading: "Πώς μπορούμε να βοηθήσουμε;", placeholder: "Αναζητήστε απαντήσεις", search: "Αναζήτηση", all: "Όλα τα άρθρα", more: "Περισσότερα άρθρα", seeAll: "Δείτε όλα", results: "Αποτελέσματα για", nothing: "Δεν βρέθηκε τίποτα. Δοκιμάστε λιγότερες ή άλλες λέξεις", empty: "Δεν υπάρχουν άρθρα ακόμα", orChat: "ή μιλήστε μαζί μας στο chat και θα σας βοηθήσουμε.", stuck: "Χρειάζεστε ακόμα βοήθεια;", chat: "Μιλήστε μαζί μας", updated: "Ενημερώθηκε", untranslated: "Αυτό το άρθρο δεν έχει μεταφραστεί ακόμα. Εδώ είναι στα", language: "Γλώσσα" },
  ar: { help: "المساعدة", heading: "كيف يمكننا مساعدتك؟", placeholder: "ابحث عن إجابات", search: "بحث", all: "كل المقالات", more: "مقالات أخرى", seeAll: "عرض الكل", results: "نتائج البحث عن", nothing: "لا توجد نتائج. جرّب كلمات أقل أو مختلفة", empty: "لا توجد مقالات بعد", orChat: "أو تحدّث معنا وسنساعدك.", stuck: "هل ما زلت بحاجة إلى مساعدة؟", chat: "تحدّث معنا", updated: "آخر تحديث", untranslated: "لم تُترجم هذه المقالة بعد. إليك النسخة باللغة", language: "اللغة" },
  he: { help: "עזרה", heading: "איך נוכל לעזור?", placeholder: "חיפוש תשובות", search: "חיפוש", all: "כל המאמרים", more: "מאמרים נוספים", seeAll: "הצג הכול", results: "תוצאות עבור", nothing: "לא נמצאו תוצאות. נסו פחות מילים או מילים אחרות", empty: "אין עדיין מאמרים", orChat: "או כתבו לנו בצ'אט ונשמח לעזור.", stuck: "עדיין צריכים עזרה?", chat: "צ'אט איתנו", updated: "עודכן", untranslated: "המאמר הזה עדיין לא תורגם. הנה הוא ב", language: "שפה" },
  hi: { help: "सहायता", heading: "हम आपकी कैसे मदद कर सकते हैं?", placeholder: "जवाब खोजें", search: "खोजें", all: "सभी लेख", more: "और लेख", seeAll: "सभी देखें", results: "इसके लिए परिणाम:", nothing: "कुछ नहीं मिला। कम या अलग शब्द आज़माएँ", empty: "अभी कोई लेख नहीं है", orChat: "या हमसे चैट करें, हम मदद करेंगे।", stuck: "अब भी मदद चाहिए?", chat: "हमसे चैट करें", updated: "अपडेट किया गया", untranslated: "इस लेख का अभी अनुवाद नहीं हुआ है। यह मूल भाषा में है:", language: "भाषा" },
  th: { help: "ความช่วยเหลือ", heading: "ให้เราช่วยอะไรดี?", placeholder: "ค้นหาคำตอบ", search: "ค้นหา", all: "บทความทั้งหมด", more: "บทความอื่นๆ", seeAll: "ดูทั้งหมด", results: "ผลการค้นหาสำหรับ", nothing: "ไม่พบผลลัพธ์ ลองใช้คำน้อยลงหรือคำอื่น", empty: "ยังไม่มีบทความ", orChat: "หรือแชทกับเรา แล้วเราจะช่วยคุณ", stuck: "ยังต้องการความช่วยเหลือ?", chat: "แชทกับเรา", updated: "อัปเดตเมื่อ", untranslated: "บทความนี้ยังไม่ได้แปล นี่คือฉบับภาษา", language: "ภาษา" },
  zh: { help: "帮助中心", heading: "需要什么帮助？", placeholder: "搜索答案", search: "搜索", all: "全部文章", more: "更多文章", seeAll: "查看全部", results: "搜索结果：", nothing: "没有找到结果。试试更少或不同的关键词", empty: "暂无文章", orChat: "或者与我们在线聊天，我们会帮你解决。", stuck: "还有问题？", chat: "在线聊天", updated: "更新于", untranslated: "这篇文章尚未翻译。以下为原文语言：", language: "语言" },
  ja: { help: "ヘルプ", heading: "どのようなことでお困りですか？", placeholder: "答えを検索", search: "検索", all: "すべての記事", more: "その他の記事", seeAll: "すべて表示", results: "検索結果：", nothing: "見つかりませんでした。単語を減らすか、別の言葉でお試しください", empty: "まだ記事はありません", orChat: "チャットでお問い合わせいただければお手伝いします。", stuck: "解決しませんか？", chat: "チャットで問い合わせる", updated: "更新日", untranslated: "この記事はまだ翻訳されていません。原文の言語：", language: "言語" },
  ko: { help: "도움말", heading: "무엇을 도와드릴까요?", placeholder: "답변 검색", search: "검색", all: "전체 문서", more: "다른 문서", seeAll: "모두 보기", results: "검색 결과:", nothing: "결과가 없습니다. 더 적거나 다른 단어로 검색해 보세요", empty: "아직 문서가 없습니다", orChat: "또는 채팅으로 문의하시면 도와드리겠습니다.", stuck: "아직 해결되지 않았나요?", chat: "채팅 문의", updated: "업데이트", untranslated: "이 문서는 아직 번역되지 않았습니다. 원문 언어:", language: "언어" },
};

export const helpWords = (lang: string): Words => (isLanguage(lang) ? W[lang] : W.en);

// Each language's name in that language, for the language menu.
const NATIVE: Record<LanguageCode, string> = {
  en: "English", es: "Español", fr: "Français", de: "Deutsch", pt: "Português", it: "Italiano", nl: "Nederlands", sv: "Svenska", pl: "Polski", tr: "Türkçe", vi: "Tiếng Việt", id: "Bahasa Indonesia",
  ru: "Русский", uk: "Українська", el: "Ελληνικά", ar: "العربية", he: "עברית", hi: "हिन्दी", th: "ไทย", zh: "中文", ja: "日本語", ko: "한국어",
};
export const nativeName = (lang: string) => (isLanguage(lang) ? NATIVE[lang] : lang);
export const isRtl = (lang: string) => lang === "ar" || lang === "he";

// The language to show: the one asked for in the address if offered, else the
// visitor's browser preference if offered, else the team's own.
export function pickLanguage(offered: string[], asked: string | undefined, acceptLanguage: string | null): string {
  if (asked && offered.includes(asked)) return asked;
  const prefs = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = Number(rest.find((r) => r.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { code: tag.toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((p) => p.code && p.q > 0)
    .sort((a, b) => b.q - a.q);
  return prefs.find((p) => offered.includes(p.code))?.code ?? offered[0];
}
