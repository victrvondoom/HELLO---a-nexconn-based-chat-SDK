import { describe, expect, it } from 'vitest';
import { parsePaymentUtterance, wordsToNumber } from '@/domain/payments/voice';

describe('voice payment drafts', () => {
  it('reads digits, currency, payee and note', () => {
    expect(parsePaymentUtterance('Pay Ben 200 rupees for lunch')).toEqual({ amountMinor: 20000, currency: 'INR', note: 'lunch', spokenPayee: 'Ben' });
    expect(parsePaymentUtterance('send $12.50 to Ada')).toMatchObject({ amountMinor: 1250, currency: 'USD', spokenPayee: 'Ada' });
    expect(parsePaymentUtterance('transfer 1,500')).toMatchObject({ amountMinor: 150000, currency: 'INR' });
  });
  it('reads spoken numbers', () => {
    expect(wordsToNumber('two hundred and fifty')).toBe(250);
    expect(wordsToNumber('one thousand five hundred')).toBe(1500);
    expect(parsePaymentUtterance('pay two hundred fifty rupees')).toMatchObject({ amountMinor: 25000 });
  });
  it('refuses sentences that are not a payment or have no amount', () => {
    expect(parsePaymentUtterance('I paid 200 yesterday')).toBeNull();
    expect(parsePaymentUtterance('pay Ben')).toBeNull();
    expect(parsePaymentUtterance('pay 0 rupees')).toBeNull();
  });
});
