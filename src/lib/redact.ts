// Card numbers never stay in Flatdesk. Customers paste them into tickets
// anyway, so any 13 to 19 digit run (spaces or dashes allowed) that passes the
// Luhn check is replaced before the message is saved, before the AI or anyone
// else reads it. The last four digits stay so the team can tell which card.

const CANDIDATE = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;

export function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export const CARD_MASK = (last4: string) => `[card number removed, ending ${last4}]`;

export function maskCards(text: string): string {
  if (!/\d{4}/.test(text)) return text;
  return text.replace(CANDIDATE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    // Card numbers start 2-6; a run of one repeated digit is a placeholder, not a card.
    if (!/^[2-6]/.test(digits) || /^(\d)\1+$/.test(digits) || !luhn(digits)) return match;
    return CARD_MASK(digits.slice(-4));
  });
}
