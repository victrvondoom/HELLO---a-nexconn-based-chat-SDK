/**
 * Turns a spoken or typed sentence ("pay Ben 200 rupees for lunch") into a payment draft.
 * It only drafts. Nothing is charged until the payer confirms on screen: a voice can be
 * overheard, replayed or imitated, so speech is never the authorisation.
 */
export const PAYMENT_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'] as const;
export type PaymentCurrency = (typeof PAYMENT_CURRENCIES)[number];

export interface PaymentDraft {
  /** Amount in minor units (paise, cents), so no floating-point money is stored. */
  amountMinor: number;
  currency: PaymentCurrency;
  note: string | null;
  /** The name the speaker used for the payee, if any. The thread decides who is actually paid. */
  spokenPayee: string | null;
}

const VERB = /\b(pay|send|transfer|give)\b/i;
const CURRENCY_WORDS: Array<{ re: RegExp; currency: PaymentCurrency }> = [
  { re: /₹|\b(rs\.?|inr|rupees?)\b/i, currency: 'INR' },
  { re: /\$|\b(usd|dollars?|bucks?)\b/i, currency: 'USD' },
  { re: /€|\b(eur|euros?)\b/i, currency: 'EUR' },
  { re: /£|\b(gbp|pounds?|quid)\b/i, currency: 'GBP' },
];
const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000 };

/** "two hundred fifty" -> 250. Returns null when the words are not a number. */
export function wordsToNumber(text: string): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const word of text.toLowerCase().replace(/-/g, ' ').split(/\s+/)) {
    if (word === 'and' || word === 'a') continue;
    if (word in UNITS) {
      current += UNITS[word] ?? 0;
      seen = true;
    } else if (word in SCALES) {
      const scale = SCALES[word] ?? 1;
      current = (current === 0 ? 1 : current) * scale;
      if (scale >= 1000) {
        total += current;
        current = 0;
      }
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + current : null;
}

const NUMBER_WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(SCALES), 'and', 'a'].join('|')})`;
const SPOKEN_AMOUNT = new RegExp(`\\b(${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*)\\b`, 'i');

export function parsePaymentUtterance(text: string, defaultCurrency: PaymentCurrency = 'INR'): PaymentDraft | null {
  const input = text.trim();
  if (!VERB.test(input)) return null;

  let amount: number | null = null;
  const digits = /(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.(\d{1,2}))?/.exec(input);
  if (digits?.[1]) {
    amount = Number(`${digits[1].replace(/,/g, '')}.${digits[2] ?? '0'}`);
  } else {
    const afterVerb = input.slice((VERB.exec(input)?.index ?? 0));
    for (const m of afterVerb.matchAll(new RegExp(SPOKEN_AMOUNT, 'gi'))) {
      const value = wordsToNumber(m[1] ?? '');
      if (value !== null && value > 0) {
        amount = value;
        break;
      }
    }
  }
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;

  const currency = CURRENCY_WORDS.find((c) => c.re.test(input))?.currency ?? defaultCurrency;
  const note = /\bfor\s+(.{2,80})$/i.exec(input)?.[1]?.replace(/[.!?]+$/, '').trim() ?? null;
  const payee = /\b(?:[Pp]ay|[Ss]end|[Tt]ransfer|[Gg]ive)\s+(?:to\s+)?([A-Z][\p{L}'-]{1,30})\b/u.exec(input)?.[1] ?? /\bto\s+([A-Z][\p{L}'-]{1,30})\b/u.exec(input)?.[1] ?? null;
  return { amountMinor: Math.round(amount * 100), currency, note, spokenPayee: payee };
}

export function formatMoney(amountMinor: number, currency: PaymentCurrency): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amountMinor / 100);
}
