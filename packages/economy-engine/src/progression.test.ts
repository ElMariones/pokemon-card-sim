import { describe, it, expect } from 'vitest';
import {
  LEVELS, MAX_LEVEL, levelForXp, nextLevel, levelProgressBp, unlockedFeatures,
  hasUnlocked, awardXp, XP_AWARDS, MISSION_TEMPLATES, missionsFor, windowEnd,
} from './progression';

describe('collector levels', () => {
  it('has strictly increasing XP thresholds', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i]!.xpRequired).toBeGreaterThan(LEVELS[i - 1]!.xpRequired);
    }
  });

  it('maps XP to the right level at and around each boundary', () => {
    for (const l of LEVELS) {
      expect(levelForXp(l.xpRequired).level).toBe(l.level);
      if (l.xpRequired > 0) {
        expect(levelForXp(l.xpRequired - 1).level).toBe(l.level - 1);
      }
    }
  });

  it('caps at the highest level and reports no next level there', () => {
    const top = LEVELS[LEVELS.length - 1]!;
    expect(levelForXp(top.xpRequired * 100).level).toBe(MAX_LEVEL);
    expect(nextLevel(top.xpRequired)).toBeNull();
    expect(levelProgressBp(top.xpRequired)).toBe(10_000);
  });

  it('reports progress between 0 and 10000 basis points at every XP value', () => {
    for (let xp = 0; xp < 60_000; xp += 137) {
      const p = levelProgressBp(xp);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(10_000);
    }
  });

  it('never revokes an unlock as XP grows', () => {
    let previous = unlockedFeatures(0);
    for (let xp = 0; xp <= 60_000; xp += 500) {
      const current = unlockedFeatures(xp);
      for (const f of previous) expect(current.has(f)).toBe(true);
      previous = current;
    }
  });

  it('gates grading behind level 5 and the shop behind level 10', () => {
    expect(hasUnlocked(0, 'grading')).toBe(false);
    expect(hasUnlocked(3_500, 'grading')).toBe(true);
    expect(hasUnlocked(49_999, 'shop')).toBe(false);
    expect(hasUnlocked(50_000, 'shop')).toBe(true);
  });
});

describe('XP awards', () => {
  it('reports a level-up and the features it unlocked', () => {
    const r = awardXp(240, 'pack_opened');
    expect(r.leveledUp).toBe(true);
    expect(r.newLevel).toBe(2);
    expect(r.newUnlocks).toContain('sell_duplicates');
  });

  it('does not report a level-up when none happened', () => {
    const r = awardXp(0, 'pack_opened');
    expect(r.leveledUp).toBe(false);
    expect(r.newUnlocks).toEqual([]);
  });

  /**
   * The balance property that matters: buying packs must not be the fastest
   * route to level 10, or the progression system rewards exactly the
   * behaviour DESIGN.md section 30 says it should not.
   */
  it('rewards completing a set far more than grinding packs', () => {
    const packsToTop = LEVELS[LEVELS.length - 1]!.xpRequired / XP_AWARDS.pack_opened;
    const setsToTop = LEVELS[LEVELS.length - 1]!.xpRequired / XP_AWARDS.set_completed;
    expect(packsToTop).toBeGreaterThan(1_000);
    expect(setsToTop).toBeLessThan(30);
    expect(XP_AWARDS.set_completed).toBeGreaterThan(XP_AWARDS.pack_opened * 100);
  });

  it('scales with count', () => {
    expect(awardXp(0, 'new_card', 10).xpGained).toBe(XP_AWARDS.new_card * 10);
  });
});

describe('missions', () => {
  it('gives every template a positive target and some reward', () => {
    for (const m of MISSION_TEMPLATES) {
      expect(m.target).toBeGreaterThan(0);
      expect(m.rewardCash + m.rewardXp).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = MISSION_TEMPLATES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('withholds level-gated missions from low-level players', () => {
    const low = missionsFor('weekly', 1).map((m) => m.id);
    const high = missionsFor('weekly', 8).map((m) => m.id);
    expect(low).not.toContain('weekly_grade_3');
    expect(high).toContain('weekly_grade_3');
  });

  it('rewards long-term missions more than daily ones', () => {
    const daily = Math.max(...missionsFor('daily', 10).map((m) => m.rewardXp));
    const longTerm = Math.min(...missionsFor('long_term', 10).map((m) => m.rewardXp));
    expect(longTerm).toBeGreaterThan(daily);
  });

  it('rolls the daily window forward exactly one UTC day', () => {
    const now = new Date('2026-08-31T14:23:00Z');
    const end = windowEnd('daily', now)!;
    expect(end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(windowEnd('long_term', now)).toBeNull();
  });
});
