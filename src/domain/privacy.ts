/**
 * Shared privacy rules. Pure.
 *
 * Any count shown to people about other people (how many come from a country, how many completed a
 * mission) is hidden when it is below MIN_GROUP_SIZE, so a count can never single out one person:
 * "1 person from Iceland" is a person, not a statistic.
 */
export const MIN_GROUP_SIZE = 3;

/** The count when it is at least MIN_GROUP_SIZE, otherwise null ("fewer than 3"). */
export function suppressSmall(count: number): number | null {
  return count >= MIN_GROUP_SIZE ? count : null;
}
