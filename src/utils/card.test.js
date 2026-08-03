import { describe, it, expect } from 'vitest';
import {
  cardRecordLabel,
  cvcLengthFor,
  detectCardBrand,
  formatCardNumber,
  formatExpiry,
  isCardComplete,
  isExpiryValid,
  maskedCardNumber,
} from './card';

const NOW = new Date(2026, 7, 2); // 2026-08-02

describe('detectCardBrand', () => {
  it('reads the brand off the leading digits', () => {
    expect(detectCardBrand('4242424242424242').id).toBe('visa');
    expect(detectCardBrand('5555 5555 5555 4444').id).toBe('mastercard');
    expect(detectCardBrand('2223 0031 2200 3222').id).toBe('mastercard');
    expect(detectCardBrand('3782 822463 10005').id).toBe('amex');
  });

  it('falls back to a 16-digit / 3-digit-CVC shape when nothing matches', () => {
    expect(detectCardBrand('').id).toBe('unknown');
    expect(detectCardBrand('9999').id).toBe('unknown');
    expect(cvcLengthFor('9999')).toBe(3);
    expect(cvcLengthFor('3782 822463')).toBe(4);
  });
});

describe('formatCardNumber', () => {
  it('groups 4-4-4-4 and caps at the brand length', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('42424242424242429999')).toBe('4242 4242 4242 4242');
  });

  it('groups Amex 4-6-5 and caps at 15', () => {
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005');
    expect(formatCardNumber('3782822463100059999')).toBe('3782 822463 10005');
  });

  it('ignores non-digits so a paste with dashes still works', () => {
    expect(formatCardNumber('4242-4242-4242-4242')).toBe('4242 4242 4242 4242');
  });
});

describe('formatExpiry', () => {
  it('inserts the separator once a month is complete', () => {
    expect(formatExpiry('1')).toBe('1');
    expect(formatExpiry('12')).toBe('12');
    expect(formatExpiry('122')).toBe('12 / 2');
    expect(formatExpiry('1228')).toBe('12 / 28');
  });

  it('pads a leading digit that can only be a month on its own', () => {
    expect(formatExpiry('9')).toBe('09');
    expect(formatExpiry('3')).toBe('03');
  });

  it('caps at four digits', () => {
    expect(formatExpiry('12289999')).toBe('12 / 28');
  });
});

describe('isExpiryValid', () => {
  it('accepts a future month', () => {
    expect(isExpiryValid('12 / 30', NOW)).toBe(true);
  });

  it('accepts the current month — a card is good to its last day', () => {
    expect(isExpiryValid('08 / 26', NOW)).toBe(true);
  });

  it('rejects a month that has passed', () => {
    expect(isExpiryValid('07 / 26', NOW)).toBe(false);
    expect(isExpiryValid('12 / 25', NOW)).toBe(false);
  });

  it('rejects impossible months and incomplete input', () => {
    expect(isExpiryValid('00 / 30', NOW)).toBe(false);
    expect(isExpiryValid('13 / 30', NOW)).toBe(false);
    expect(isExpiryValid('12 / 3', NOW)).toBe(false);
    expect(isExpiryValid('', NOW)).toBe(false);
  });
});

describe('isCardComplete', () => {
  const good = { number: '4242 4242 4242 4242', expiry: '12 / 30', cvc: '123', name: 'A Namukasa' };

  it('accepts a fully-filled card', () => {
    expect(isCardComplete(good, NOW)).toBe(true);
  });

  it('rejects a short number, a past expiry, a short CVC or a missing name', () => {
    expect(isCardComplete({ ...good, number: '4242 4242 4242 424' }, NOW)).toBe(false);
    expect(isCardComplete({ ...good, expiry: '01 / 20' }, NOW)).toBe(false);
    expect(isCardComplete({ ...good, cvc: '12' }, NOW)).toBe(false);
    expect(isCardComplete({ ...good, name: ' ' }, NOW)).toBe(false);
    expect(isCardComplete(null, NOW)).toBe(false);
  });

  it('holds Amex to 15 digits and a 4-digit CVC', () => {
    const amex = { number: '3782 822463 10005', expiry: '12 / 30', cvc: '1234', name: 'A Namukasa' };
    expect(isCardComplete(amex, NOW)).toBe(true);
    expect(isCardComplete({ ...amex, cvc: '123' }, NOW)).toBe(false);
  });

  // No Luhn check by design — a rep typing arbitrary digits mid-demo must not
  // be blocked. See the note at the top of utils/card.js.
  it('accepts a well-formed number that fails a checksum', () => {
    expect(isCardComplete({ ...good, number: '4111 1111 1111 1112' }, NOW)).toBe(true);
  });
});

describe('record + masked labels', () => {
  it('renders the brand and last four for the transactions.method column', () => {
    expect(cardRecordLabel({ number: '4242 4242 4242 4242' })).toBe('Visa •••• 4242');
    expect(cardRecordLabel({ number: '5555 5555 5555 4444' })).toBe('Mastercard •••• 4444');
    expect(cardRecordLabel({ number: '' })).toBe('Card');
  });

  it('masks all but the last group', () => {
    expect(maskedCardNumber({ number: '4242 4242 4242 4242' })).toBe('•••• •••• •••• 4242');
    expect(maskedCardNumber({ number: '3782 822463 10005' })).toBe('•••• •••••• 0005');
    expect(maskedCardNumber({ number: '' })).toBe('');
  });
});
