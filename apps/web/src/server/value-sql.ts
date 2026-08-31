import { sql, type SQL } from 'drizzle-orm';
import { inventoryItems, cards, grades } from '@pcs/db/schema';
import {
  CONDITION_MULTIPLIER_BP, GRADE_MULTIPLIER_BP, BLACK_LABEL_BONUS_BP,
} from '@pcs/economy-engine';

/**
 * The effective value of an inventory row, expressed in SQL.
 *
 * This exists so "sort by value" sorts by the number actually shown. The value
 * is base price × condition multiplier × grade multiplier, and computing it in
 * JavaScript after the query meant the database was ordering on the raw price
 * — so a graded card, whose value can be several times its raw price, landed
 * in the wrong place.
 *
 * The expression is GENERATED from the same constants the runtime uses rather
 * than hand-written, so there is still one source of truth: change a
 * multiplier and this changes with it.
 */

const caseFrom = (
  column: unknown,
  entries: [string, number][],
  fallback = 10_000,
): string => {
  const whens = entries.map(([k, v]) => `when '${k}' then ${v}`).join(' ');
  return `case ${column} ${whens} else ${fallback} end`;
};

/** Condition multiplier in basis points, or 10000 when unset. */
function conditionBpSql(): string {
  const entries = Object.entries(CONDITION_MULTIPLIER_BP) as [string, number][];
  return caseFrom('"inventory_items"."condition"', entries);
}

/**
 * Grade multiplier in basis points, keyed on company and numeric grade.
 * A Black Label carries its extra bonus, matching gradedValue().
 */
function gradeBpSql(): string {
  const branches: string[] = [];
  for (const [company, table] of Object.entries(GRADE_MULTIPLIER_BP)) {
    for (const [grade, bp] of Object.entries(table)) {
      branches.push(
        `when "grades"."grade_company" = '${company}' and "grades"."numeric_grade" = ${grade} then ${bp}`,
      );
    }
  }
  const base = `case ${branches.join(' ')} else 10000 end`;

  return `
    case
      when "grades"."numeric_grade" is null then 10000
      when coalesce("grades"."label", '') like '%Black Label%'
        then (${base})::bigint * ${BLACK_LABEL_BONUS_BP} / 10000
      else (${base})
    end`;
}

/**
 * Value in cents.
 *
 * Multiplications happen before the divisions so integer truncation cannot
 * reorder two rows that are close together — but that means the intermediate
 * product is price x 10000 x up to 150000, which overflows a 32-bit integer at
 * around a $2 card. The cast to bigint is what makes the ordering correct
 * rather than an error.
 */
export function inventoryValueSql(): SQL {
  return sql.raw(`
    (coalesce("cards"."market_base_price", 0)::bigint
      * (${conditionBpSql()})::bigint
      * (${gradeBpSql()})::bigint
      / 100000000)
  `);
}
