import { describe, expect, it } from 'vitest';
import { cardNumberOf, selectBoosterPack, toPriceSourceCard } from './tcgcsv';
import { selectBasePrice } from './price-selection';

const priced = (subTypeName: string, marketPrice: number | null, extra = {}) => ({
  productId: 1, subTypeName, marketPrice, ...extra,
});

describe('toPriceSourceCard', () => {
  it('maps TCGplayer sub-types onto the variant keys the price policy prefers', () => {
    const card = toPriceSourceCard([
      priced('Reverse Holofoil', 1.25),
      priced('Normal', 0.09),
    ]);
    expect(Object.keys(card.tcgplayer?.prices ?? {})).toEqual(['reverseHolofoil', 'normal']);
    expect(card.tcgplayer?.prices?.normal?.market).toBe(0.09);
  });

  it('feeds the existing price policy, which prefers the ordinary printing', () => {
    const card = toPriceSourceCard([
      priced('Reverse Holofoil', 1.25),
      priced('Normal', 0.09),
    ]);
    const selection = selectBasePrice(card);
    expect(selection.basis).toBe('tcgplayer_market');
    expect(selection.variant).toBe('normal');
    expect(selection.price).toBe(9);
  });

  it('treats a zero or null quote as absent, never as a free card', () => {
    const card = toPriceSourceCard([priced('Normal', 0, { midPrice: 0, lowPrice: null })]);
    expect(card.tcgplayer?.prices?.normal).toEqual({});
    expect(selectBasePrice(card).price).toBeNull();
  });
});

describe('selectBoosterPack', () => {
  const products = [
    { productId: 10, name: 'Pitch Black Booster Box' },
    { productId: 11, name: 'Code Card - Pitch Black Booster Pack' },
    { productId: 12, name: 'Pitch Black Booster Pack' },
    { productId: 13, name: 'Pitch Black Booster Pack Art Bundle [Set of 4]' },
    { productId: 14, name: 'Pitch Black Sleeved Booster Pack' },
  ];

  it('picks the plain booster pack, not the code card or the art bundle', () => {
    const prices = new Map([[12, { productId: 12, subTypeName: 'Normal', marketPrice: 5.79 }]]);
    expect(selectBoosterPack(products, prices)?.product.productId).toBe(12);
  });

  it('prefers a pack with a market price over one without', () => {
    const twoPrintings = [
      { productId: 20, name: 'Jungle Booster Pack [1st Edition]' },
      { productId: 21, name: 'Jungle Booster Pack [Unlimited Edition]' },
    ];
    const prices = new Map([[21, { productId: 21, subTypeName: 'Normal', marketPrice: 287.19 }]]);
    expect(selectBoosterPack(twoPrintings, prices)?.marketPrice).toBe(287.19);
  });

  it('does not read an exclusion word out of the middle of a set name', () => {
    // 'Destined' contains 'tin'; the exclusions are words, not substrings.
    const destined = [{ productId: 40, name: 'Destined Rivals Booster Pack' }];
    const prices = new Map([[40, { productId: 40, subTypeName: 'Normal', marketPrice: 8.89 }]]);
    expect(selectBoosterPack(destined, prices)?.marketPrice).toBe(8.89);
  });

  it('returns null for a set that never had a booster pack', () => {
    const promos = [{ productId: 30, name: 'POP Series 4 Booster Box' }];
    expect(selectBoosterPack(promos, new Map())).toBeNull();
  });
});

describe('cardNumberOf', () => {
  it('reduces a collector number to the catalogue form', () => {
    expect(cardNumberOf({ productId: 1, name: 'Tropius - 001/084', extendedData: [{ name: 'Number', value: '001/084' }] })).toBe('1');
  });

  it('keeps a lettered gallery number intact', () => {
    expect(cardNumberOf({ productId: 1, name: 'x', extendedData: [{ name: 'Number', value: 'TG01/TG30' }] })).toBe('TG01');
  });

  it('returns null for a sealed product', () => {
    expect(cardNumberOf({ productId: 1, name: 'Pitch Black Booster Pack', extendedData: [] })).toBeNull();
  });
});
