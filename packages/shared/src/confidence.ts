/**
 * Where a number came from, and how much we are allowed to imply about it.
 *
 * Design doc section 5, "Never fake precision": the UI must not render
 * "1.72% chance" unless the underlying source actually supports that figure.
 * Every pull rate, pack template and price carries one of these.
 */
export const CONFIDENCE_LEVELS = [
  'official',
  'manufacturer_published',
  'documented_community_data',
  'estimated',
  'unknown',
] as const;

export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** True when we may show an exact percentage to the player. */
export function mayDisplayExactRate(c: Confidence): boolean {
  return c === 'official' || c === 'manufacturer_published';
}

/** The phrase the UI must use when describing a rate of this confidence. */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  official: 'Official pull rate',
  manufacturer_published: 'Published pull rate',
  documented_community_data: 'Community-documented rate',
  estimated: 'Estimated pull rate',
  unknown: 'Pull rate unknown',
};
