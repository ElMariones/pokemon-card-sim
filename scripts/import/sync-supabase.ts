/**
 * Push the local database state to the linked Supabase project.
 *
 * The importers run against PGlite because they are slow and chatty and the
 * price feeds are large. This is the step that makes production match: schema
 * first, then the tables the price pipeline owns.
 *
 * It is idempotent and safe to re-run. It never deletes.
 *
 *   npx tsx scripts/import/sync-supabase.ts --schema      # DDL only
 *   npx tsx scripts/import/sync-supabase.ts --dry-run     # print, do not write
 *   npx tsx scripts/import/sync-supabase.ts
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { isNotNull } from 'drizzle-orm';
import { getDb } from '../../packages/db/src/index';
import { cards, packTemplates, sets } from '../../packages/db/src/schema';
import { atom, json, linkedQuery, linkedRows } from './supabase';
import { chunk, parseArgs, runScript } from './http';

const MIGRATIONS = path.resolve('packages/db/migrations');

interface Journal { entries: { idx: number; tag: string; when: number }[] }

/**
 * Drizzle's migrator is all-or-nothing and this project's remote has drifted:
 * some DDL was applied by hand and never recorded. So statements are made
 * idempotent and anything we cannot make idempotent stops the run rather than
 * being guessed at.
 */
function idempotent(statement: string): string {
  const s = statement.trim();
  if (/^create table (?!if not exists)/i.test(s)) return s.replace(/^create table /i, 'CREATE TABLE IF NOT EXISTS ');
  if (/^create (unique )?index (?!if not exists)/i.test(s)) {
    return s.replace(/^create (unique )?index /i, (_m, unique: string | undefined) => `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS `);
  }
  if (/add column (?!if not exists)/i.test(s)) return s.replace(/add column /gi, 'ADD COLUMN IF NOT EXISTS ');
  if (/^(alter table .* add constraint|create schema|create type|do \$\$|insert into|--)/i.test(s)) return s;
  throw new Error(`Cannot make this statement idempotent, run it by hand:\n${s}`);
}

async function syncSchema(dryRun: boolean): Promise<void> {
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as Journal;
  const recordedHashes = new Set(
    (await linkedRows<{ hash: string }>('select hash from drizzle.__drizzle_migrations')).map((r) => r.hash),
  );
  const pending = [] as { tag: string; when: number; hash: string; sql: string }[];
  for (const entry of journal.entries) {
    const sql = await readFile(path.join(MIGRATIONS, `${entry.tag}.sql`), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    if (!recordedHashes.has(hash)) pending.push({ tag: entry.tag, when: entry.when, hash, sql });
  }

  console.log(`Schema: ${journal.entries.length} migrations, ${recordedHashes.size} already applied, ${pending.length} pending`);

  for (const entry of pending) {
    const { hash, sql } = entry;
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim().replace(/;$/, ''))
      .filter(Boolean);
    const applied: string[] = [];
    for (const statement of statements) applied.push(idempotent(statement));

    // One transaction per migration: either the whole thing lands and is
    // recorded, or the record is not written and the next run retries it.
    const recorded =
      `insert into drizzle.__drizzle_migrations (hash, created_at) ` +
      `select ${atom(hash)}, ${atom(entry.when)} ` +
      `where not exists (select 1 from drizzle.__drizzle_migrations where hash = ${atom(hash)});`;
    const batch = `begin;\n${applied.join(';\n')};\n${recorded}\ncommit;`;

    if (dryRun) { console.log(`\n-- ${entry.tag}\n${batch}`); continue; }
    await linkedQuery(batch);
    console.log(`  ${entry.tag} ok`);
  }
}

async function syncData(dryRun: boolean): Promise<void> {
  const db = await getDb();

  const setRows = await db.select({ id: sets.id, ptcgoCode: sets.ptcgoCode }).from(sets);
  const withCode = setRows.filter((s) => s.ptcgoCode);
  console.log(`\nSets: ${withCode.length} PTCGO codes`);
  for (const batch of chunk(withCode, 200)) {
    const values = batch.map((s) => `(${atom(s.id)},${atom(s.ptcgoCode!)})`).join(',');
    const sql = `update public.sets as t set ptcgo_code = v.code from (values ${values}) as v(id, code) where t.id = v.id;`;
    if (dryRun) { console.log(sql.slice(0, 200) + '...'); continue; }
    await linkedQuery(sql);
  }

  const cardRows = await db
    .select({
      id: cards.id, price: cards.marketBasePrice,
      confidence: cards.priceConfidence, source: cards.priceSource,
    })
    .from(cards)
    .where(isNotNull(cards.marketBasePrice));
  console.log(`Cards: ${cardRows.length} priced`);
  let done = 0;
  for (const batch of chunk(cardRows, 1000)) {
    const values = batch
      .map((c) => `(${atom(c.id)},${atom(c.price!)},${atom(c.confidence)},${atom(c.source ?? 'unknown')})`)
      .join(',');
    const update =
      `update public.cards as c set market_base_price = v.price, price_confidence = v.confidence, ` +
      `price_source = v.source, price_updated_at = now() ` +
      `from (values ${values}) as v(id, price, confidence, source) where c.id = v.id;`;
    const state =
      `insert into public.market_state (card_id, current_price, updated_at) values ` +
      `${batch.map((c) => `(${atom(c.id)},${atom(c.price!)},now())`).join(',')} ` +
      `on conflict (card_id) do update set current_price = excluded.current_price, updated_at = excluded.updated_at;`;
    if (dryRun) { console.log(`  batch of ${batch.length} cards`); continue; }
    await linkedQuery(`begin;\n${update}\n${state}\ncommit;`);
    done += batch.length;
    console.log(`  ${done}/${cardRows.length}`);
  }

  const templates = await db.select().from(packTemplates);
  console.log(`Pack templates: ${templates.length}`);
  for (const batch of chunk(templates, 25)) {
    const values = batch
      .map((t) =>
        `(${atom(t.id)},${atom(t.setId)},${atom(t.name)},${atom(t.productType)},${atom(t.cardsPerPack)},` +
        `${json(t.slots)},${atom(t.simulatorPrice)},` +
        `${t.marketBasePrice === null ? 'null::int' : atom(t.marketBasePrice)},` +
        `${atom(t.priceConfidence)},${t.priceSource === null ? 'null::text' : atom(t.priceSource)},` +
        `${atom(t.confidence)},${atom(t.source)},${atom(t.version)})`)
      .join(',');
    const sql =
      `insert into public.pack_templates ` +
      `(id, set_id, name, product_type, cards_per_pack, slots, simulator_price, market_base_price, ` +
      `price_confidence, price_source, confidence, source, version) values ${values} ` +
      `on conflict (id) do update set cards_per_pack = excluded.cards_per_pack, slots = excluded.slots, ` +
      `simulator_price = excluded.simulator_price, market_base_price = excluded.market_base_price, ` +
      `price_confidence = excluded.price_confidence, price_source = excluded.price_source, ` +
      `price_updated_at = case when excluded.market_base_price is null then null else now() end, ` +
      `confidence = excluded.confidence, source = excluded.source, version = excluded.version;`;
    if (dryRun) { console.log(`  batch of ${batch.length} templates`); continue; }
    await linkedQuery(sql);
  }
  console.log('  done');
}

async function main() {
  const args = parseArgs();
  const dryRun = Boolean(args['dry-run']);
  if (dryRun) console.log('DRY RUN — nothing is written\n');

  await syncSchema(dryRun);
  if (!args.schema) await syncData(dryRun);

  console.log(dryRun ? '\nDry run complete.' : '\nLinked project is in sync with the local database.');
  process.exit(0);
}

runScript(main);
