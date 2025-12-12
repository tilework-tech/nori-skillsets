/**
 * Migration instruction type definitions
 */

/**
 * Migration instruction interface
 * Each migration defines a trigger function that returns:
 * - A message string if migration is needed
 * - null if no migration is needed
 */
export type MigrationInstruction = {
  trigger: (args: { installDir: string }) => string | null;
};
