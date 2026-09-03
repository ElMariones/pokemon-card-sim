/**
 * The typing game's word supply.
 *
 * These are real card names, set names and hobby vocabulary, so the passage
 * reads as something from inside the game rather than as filler. The corpus
 * lives here rather than being drawn from the card database on purpose: the
 * server has to rebuild the exact passage from the seed at settle time, and a
 * corpus that shifted whenever an importer ran would make yesterday's run
 * unverifiable.
 */

export const TYPE_CORPUS: readonly string[] = [
  // Cards people actually chase
  'Charizard', 'Blastoise', 'Venusaur', 'Pikachu', 'Raichu', 'Alakazam',
  'Machamp', 'Gengar', 'Gyarados', 'Lapras', 'Eevee', 'Vaporeon', 'Jolteon',
  'Flareon', 'Snorlax', 'Articuno', 'Zapdos', 'Moltres', 'Dragonite', 'Mewtwo',
  'Mew', 'Lugia', 'Celebi', 'Rayquaza', 'Groudon', 'Kyogre', 'Jirachi',
  'Garchomp', 'Lucario', 'Darkrai', 'Arceus', 'Zoroark', 'Greninja', 'Zacian',
  // Sets and eras
  'base set', 'jungle', 'fossil', 'team rocket', 'neo genesis', 'skyridge',
  'ruby and sapphire', 'diamond and pearl', 'black and white',
  'evolving skies', 'hidden fates', 'shining fates', 'crown zenith',
  'obsidian flames', 'paldea evolved',
  // The vocabulary of the hobby
  'holographic', 'reverse holo', 'illustration rare', 'secret rare', 'promo',
  'first edition', 'shadowless', 'near mint', 'lightly played', 'graded',
  'population report', 'centering', 'surface', 'binder', 'sleeve', 'toploader',
  'booster box', 'elite trainer box', 'pull rate', 'god pack', 'hit',
];
