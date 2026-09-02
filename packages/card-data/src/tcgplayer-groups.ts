/**
 * Matching a catalogue set to a TCGplayer group.
 *
 * The two vocabularies were never designed to line up. The catalogue calls a
 * set "Ruby & Sapphire"; TCGplayer calls the same products "EX Ruby and
 * Sapphire". TCGplayer also prefixes modern groups with the vendor's own set
 * number ("ME05: Pitch Black").
 *
 * The reliable key is the PTCGO code, which both sides publish: the catalogue
 * as `ptcgoCode`, TCGplayer as `abbreviation`. It resolves 129 of 174 sets and
 * carries a useful property for free — the catalogue gives a subset the same
 * code as its parent ('swsh12tg' and 'swsh12' are both 'SIT'), so a Trainer
 * Gallery resolves to the parent's group and inherits the parent's sealed
 * price without a separate inheritance rule.
 *
 * Name matching handles the rest, and an override table handles what neither
 * can. Nothing here guesses: an unmatched set returns null and is reported.
 */

export interface TcgplayerGroup {
  groupId: number;
  name: string;
  abbreviation?: string | null;
}

export interface SetIdentity {
  id: string;
  name: string;
  ptcgoCode?: string | null;
}

/**
 * Sets whose name matches nothing on the TCGplayer side, resolved by hand.
 *
 * Every entry is a set whose catalogue name is a shortening of the retail name
 * ("Base" for "Base Set") or uses different words for the same products.
 */
export const GROUP_OVERRIDES: Readonly<Record<string, number>> = {
  sm1: 1863,   // "Sun & Moon"     -> "SM Base Set"                    (codes SUM vs SM01)
  swsh1: 2585, // "Sword & Shield" -> "SWSH01: Sword & Shield Base Set" (codes SSH vs SWSH01)
};

/** Era tokens TCGplayer prepends to a group name but the catalogue omits. */
const ERA_TOKENS = new Set([
  'ex', 'hs', 'sv', 'swsh', 'xy', 'bw', 'dp', 'hgss', 'pl', 'me', 'sm', 'pop', 'np',
]);

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[—–]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Every spelling of a name we are willing to treat as equal: as written, with
 * the vendor's "ME05:" prefix removed, and with a leading era token removed.
 */
function nameKeys(name: string): Set<string> {
  const keys = new Set<string>();
  for (const variant of [name, name.replace(/^[A-Za-z]{1,6}\d{0,3}(?:pt5)?:\s*/i, '')]) {
    const normalized = normalize(variant);
    if (!normalized) continue;
    keys.add(normalized);
    const [head, ...tail] = normalized.split(' ');
    if (tail.length > 0 && head && ERA_TOKENS.has(head)) keys.add(tail.join(' '));
  }
  return keys;
}

function byName(set: SetIdentity, groups: readonly TcgplayerGroup[]): TcgplayerGroup | null {
  const wanted = nameKeys(set.name);
  return (
    groups.find((g) => {
      for (const key of nameKeys(g.name)) if (wanted.has(key)) return true;
      return false;
    }) ?? null
  );
}

/**
 * The group holding a set's SEALED products, or null when we cannot tell.
 *
 * Code first, which is what makes a subset resolve to its parent: a Trainer
 * Gallery has no booster pack of its own, and the pack a player buys to open
 * it is the parent set's.
 */
export function resolveGroup(
  set: SetIdentity,
  groups: readonly TcgplayerGroup[],
): TcgplayerGroup | null {
  const override = GROUP_OVERRIDES[set.id];
  if (override !== undefined) {
    return groups.find((g) => g.groupId === override) ?? null;
  }

  const code = set.ptcgoCode?.trim().toUpperCase();
  if (code) {
    const byCode = groups.find((g) => g.abbreviation?.trim().toUpperCase() === code);
    if (byCode) return byCode;
  }

  return byName(set, groups);
}

/**
 * The group holding a set's SINGLES, which is the most specific one.
 *
 * Name first here, for two reasons. TCGplayer files a Shiny Vault's cards
 * under their own group even though the catalogue gives them the parent's
 * code, and abbreviations collide across eras — 'BST' is both Battle Styles
 * and EX Battle Stadium, whose cards have nothing to do with each other.
 */
export function resolveCardGroup(
  set: SetIdentity,
  groups: readonly TcgplayerGroup[],
): TcgplayerGroup | null {
  const override = GROUP_OVERRIDES[set.id];
  if (override !== undefined) return groups.find((g) => g.groupId === override) ?? null;
  return byName(set, groups) ?? resolveGroup(set, groups);
}
