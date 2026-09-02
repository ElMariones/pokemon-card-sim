import { describe, expect, it } from 'vitest';
import { resolveCardGroup, resolveGroup, type TcgplayerGroup } from './tcgplayer-groups';

const groups: TcgplayerGroup[] = [
  { groupId: 604, name: 'Base Set', abbreviation: 'BS' },
  { groupId: 1393, name: 'EX Ruby and Sapphire', abbreviation: 'RS' },
  { groupId: 24688, name: 'ME05: Pitch Black', abbreviation: 'PBL' },
  { groupId: 3143, name: 'Silver Tempest', abbreviation: 'SIT' },
  { groupId: 2867, name: 'Celebrations', abbreviation: 'CEL' },
];

describe('resolveGroup', () => {
  it('matches a set to the group sharing its PTCGO code', () => {
    const set = { id: 'me5', name: 'Pitch Black', ptcgoCode: 'PBL' };
    expect(resolveGroup(set, groups)?.groupId).toBe(24688);
  });

  it('resolves a subset through the PTCGO code it shares with its parent', () => {
    const subset = { id: 'swsh12tg', name: 'Silver Tempest Trainer Gallery', ptcgoCode: 'SIT' };
    expect(resolveGroup(subset, groups)?.groupId).toBe(3143);
  });

  it('falls back to the group name once era prefixes and ampersands are normalized', () => {
    const set = { id: 'ex1', name: 'Ruby & Sapphire', ptcgoCode: null };
    expect(resolveGroup(set, groups)?.groupId).toBe(1393);
  });

  it('ignores the vendor set-number prefix on a group name', () => {
    const set = { id: 'me5', name: 'Pitch Black', ptcgoCode: null };
    expect(resolveGroup(set, groups)?.groupId).toBe(24688);
  });

  it('uses the override table when neither code nor name matches', () => {
    // 'Sun & Moon' is 'SM Base Set' on TCGplayer, and the codes differ too.
    const set = { id: 'sm1', name: 'Sun & Moon', ptcgoCode: 'SUM' };
    const smGroups = [{ groupId: 1863, name: 'SM Base Set', abbreviation: 'SM01' }];
    expect(resolveGroup(set, smGroups)?.groupId).toBe(1863);
  });

  it('returns null rather than guessing when nothing matches', () => {
    const set = { id: 'mcd21', name: "McDonald's Collection 2021", ptcgoCode: null };
    expect(resolveGroup(set, groups)).toBeNull();
  });
});

describe('resolveCardGroup', () => {
  const withSubsets: TcgplayerGroup[] = [
    { groupId: 2754, name: 'Shining Fates', abbreviation: 'SHF' },
    { groupId: 2781, name: 'Shining Fates: Shiny Vault', abbreviation: 'SHFSV' },
    ...groups,
  ];

  it('prices a subset from its own group, not its parent', () => {
    const subset = { id: 'swsh45sv', name: 'Shining Fates Shiny Vault', ptcgoCode: 'SHF' };
    expect(resolveCardGroup(subset, withSubsets)?.groupId).toBe(2781);
  });

  it('falls back to the parent group when the subset has none of its own', () => {
    const subset = { id: 'swsh12tg', name: 'Silver Tempest Trainer Gallery', ptcgoCode: 'SIT' };
    expect(resolveCardGroup(subset, withSubsets)?.groupId).toBe(3143);
  });

  it('prefers the matching name over another set sharing the abbreviation', () => {
    const colliding: TcgplayerGroup[] = [
      { groupId: 1, name: 'EX Battle Stadium', abbreviation: 'BST' },
      { groupId: 2765, name: 'SWSH05: Battle Styles', abbreviation: 'SWSH05' },
    ];
    const set = { id: 'swsh5', name: 'Battle Styles', ptcgoCode: 'BST' };
    expect(resolveCardGroup(set, colliding)?.groupId).toBe(2765);
    // The sealed lookup keeps code precedence, which is what makes a subset
    // inherit its parent's pack.
    expect(resolveGroup(set, colliding)?.groupId).toBe(1);
  });
});
