import { cents, type Cents, type Condition } from '../../shared/src/index';
import { applyBp, bp, type Bp } from './basis-points';
import { conditionRank } from './condition';
import { weightedPick, type Rng } from './rng';

/**
 * Card grading (DESIGN.md section 11).
 *
 * The three companies are modelled on what actually distinguishes them in the
 * real hobby: PSA is the volume leader whose 10 carries the strongest price
 * premium; Beckett grades four subgrades and its Black Label (all four at 10)
 * is the rarest and most valuable outcome; CGC is cheaper and faster but its
 * grades command less of a premium.
 */

export type GradeCompany = 'PSA' | 'BGS' | 'CGC';

export interface ServiceTier {
  id: string;
  company: GradeCompany;
  name: string;
  fee: Cents;
  /** Turnaround in in-game hours. */
  turnaroundHours: number;
  /** Declared-value ceiling; above this the tier is unavailable. */
  maxDeclaredValue: Cents;
}

export const SERVICE_TIERS: readonly ServiceTier[] = [
  { id: 'psa-value',     company: 'PSA', name: 'PSA Value',       fee: cents(2_500),  turnaroundHours: 72, maxDeclaredValue: cents(50_000) },
  { id: 'psa-express',   company: 'PSA', name: 'PSA Express',     fee: cents(7_500),  turnaroundHours: 24, maxDeclaredValue: cents(250_000) },
  { id: 'bgs-standard',  company: 'BGS', name: 'Beckett Standard',fee: cents(3_500),  turnaroundHours: 96, maxDeclaredValue: cents(100_000) },
  { id: 'bgs-premium',   company: 'BGS', name: 'Beckett Premium', fee: cents(12_000), turnaroundHours: 36, maxDeclaredValue: cents(1_000_000) },
  { id: 'cgc-standard',  company: 'CGC', name: 'CGC Standard',    fee: cents(1_800),  turnaroundHours: 60, maxDeclaredValue: cents(50_000) },
];

export interface GradeResult {
  company: GradeCompany;
  numericGrade: number;
  label: string;
  /** Beckett only: the four subgrades that decide a Black Label. */
  subgrades?: { centering: number; corners: number; edges: number; surface: number };
  isBlackLabel?: boolean;
}

export const GRADE_LABEL: Record<number, string> = {
  10: 'Gem Mint',
  9: 'Mint',
  8: 'Near Mint/Mint',
  7: 'Near Mint',
  6: 'Excellent-Mint',
  5: 'Excellent',
  4: 'Very Good-Excellent',
  3: 'Very Good',
  2: 'Good',
  1: 'Poor',
};

/**
 * GAME-DESIGN VALUES, NOT REAL GRADING STATISTICS.
 *
 * DESIGN.md section 11 is explicit about this: these numbers exist to make the
 * grading decision interesting and must be balanced through playtesting. They
 * are not a claim about how any real grading company grades, and nothing in
 * the UI should present them as one.
 */
const GRADE_WEIGHTS_BY_CONDITION: Record<Condition, readonly { value: number; weight: number }[]> = {
  near_mint: [
    { value: 10, weight: 8 }, { value: 9, weight: 35 }, { value: 8, weight: 40 },
    { value: 7, weight: 14 }, { value: 6, weight: 3 },
  ],
  lightly_played: [
    { value: 9, weight: 10 }, { value: 8, weight: 34 }, { value: 7, weight: 36 },
    { value: 6, weight: 15 }, { value: 5, weight: 5 },
  ],
  moderately_played: [
    { value: 7, weight: 18 }, { value: 6, weight: 34 }, { value: 5, weight: 30 },
    { value: 4, weight: 14 }, { value: 3, weight: 4 },
  ],
  heavily_played: [
    { value: 5, weight: 20 }, { value: 4, weight: 34 }, { value: 3, weight: 30 },
    { value: 2, weight: 16 },
  ],
  damaged: [
    { value: 3, weight: 25 }, { value: 2, weight: 45 }, { value: 1, weight: 30 },
  ],
};

export function rollGrade(company: GradeCompany, condition: Condition, rng: Rng): GradeResult {
  const numericGrade = weightedPick(rng, GRADE_WEIGHTS_BY_CONDITION[condition]);

  if (company !== 'BGS') {
    return { company, numericGrade, label: GRADE_LABEL[numericGrade] ?? String(numericGrade) };
  }

  // Beckett assigns four subgrades; a Black Label needs all four at 10.
  const sub = () => Math.min(10, Math.max(1, numericGrade + (rng() < 0.35 ? 0 : rng() < 0.5 ? -1 : 1)));
  const subgrades = { centering: sub(), corners: sub(), edges: sub(), surface: sub() };
  const isBlackLabel =
    numericGrade === 10 && Object.values(subgrades).every((v) => v === 10);

  return {
    company,
    numericGrade,
    label: isBlackLabel ? 'Pristine 10 (Black Label)' : (GRADE_LABEL[numericGrade] ?? String(numericGrade)),
    subgrades,
    isBlackLabel,
  };
}

/**
 * How much the market pays for a graded card relative to its raw value.
 * A low grade is worth LESS than the raw card, because grading a played card
 * certifies that it is played — that is the risk the player is taking.
 */
const GRADE_MULTIPLIER_BP: Record<GradeCompany, Record<number, Bp>> = {
  PSA: {
    10: bp(60_000), 9: bp(20_000), 8: bp(11_000), 7: bp(8_000),
    6: bp(6_500), 5: bp(5_500), 4: bp(4_500), 3: bp(3_500), 2: bp(2_500), 1: bp(1_500),
  },
  BGS: {
    10: bp(55_000), 9: bp(18_000), 8: bp(10_500), 7: bp(7_500),
    6: bp(6_000), 5: bp(5_000), 4: bp(4_000), 3: bp(3_000), 2: bp(2_200), 1: bp(1_400),
  },
  CGC: {
    10: bp(38_000), 9: bp(15_000), 8: bp(9_500), 7: bp(7_000),
    6: bp(5_500), 5: bp(4_500), 4: bp(3_800), 3: bp(2_800), 2: bp(2_000), 1: bp(1_200),
  },
};

/** A Beckett Black Label is the rarest outcome in the hobby and priced as such. */
export const BLACK_LABEL_BONUS_BP = bp(25_000);

export function gradedValue(rawValue: Cents, grade: GradeResult): Cents {
  const table = GRADE_MULTIPLIER_BP[grade.company];
  const multiplier = table[grade.numericGrade] ?? bp(10_000);
  const base = applyBp(rawValue, multiplier);
  return grade.isBlackLabel ? applyBp(base, BLACK_LABEL_BONUS_BP) : base;
}

/** Whether grading this card could plausibly pay for itself. */
export function isGradingWorthwhile(rawValue: Cents, tier: ServiceTier): boolean {
  const optimistic = applyBp(rawValue, GRADE_MULTIPLIER_BP[tier.company][9] ?? bp(10_000));
  return optimistic > rawValue + tier.fee;
}
