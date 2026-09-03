import { describe, expect, it } from 'vitest';
import {
  assertConfirmedSupabaseUrl, CONFIRMED_SUPABASE_PROJECT_REF,
} from '@pcs/db';

describe('database environment guard', () => {
  it('accepts direct and session-pooler URLs for the confirmed Supabase project', () => {
    expect(() => assertConfirmedSupabaseUrl(
      `postgresql://postgres:secret@db.${CONFIRMED_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres`,
    )).not.toThrow();
    expect(() => assertConfirmedSupabaseUrl(
      `postgresql://postgres.${CONFIRMED_SUPABASE_PROJECT_REF}:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
    )).not.toThrow();
  });

  it('rejects another project or a non-Postgres URL', () => {
    expect(() => assertConfirmedSupabaseUrl(
      'postgresql://postgres.someone-else:secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres',
    )).toThrow(/confirmed Supabase project/);
    expect(() => assertConfirmedSupabaseUrl(
      `https://db.${CONFIRMED_SUPABASE_PROJECT_REF}.supabase.co/postgres`,
    )).toThrow(/confirmed Supabase project/);
  });
});
