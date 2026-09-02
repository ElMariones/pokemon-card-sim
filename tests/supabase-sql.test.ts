import { describe, expect, it } from 'vitest';
import { atom, json } from '../scripts/import/supabase';

describe('atom', () => {
  it('quotes a string and doubles any quote inside it', () => {
    expect(atom("Farfetch'd")).toBe("'Farfetch''d'");
  });

  it('passes an integer through unquoted', () => {
    expect(atom(846)).toBe('846');
  });

  it('refuses a non-integer, because money is cents', () => {
    expect(() => atom(8.46)).toThrow(/non-integer/i);
  });
});

describe('json', () => {
  it('renders a value as a quoted jsonb literal', () => {
    expect(json({ a: 1 })).toBe(`'{"a":1}'::jsonb`);
  });

  it('escapes quotes inside the payload', () => {
    expect(json({ name: "Farfetch'd" })).toBe(`'{"name":"Farfetch''d"}'::jsonb`);
  });
});
