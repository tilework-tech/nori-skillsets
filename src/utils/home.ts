/**
 * Home directory helper with environment variable override support.
 *
 * Supports NORI_GLOBAL_CONFIG environment variable for test isolation
 * and custom configuration directory overrides.
 */

import * as os from "os";

/**
 * Get the home directory with override support.
 *
 * Order of precedence:
 * 1. NORI_GLOBAL_CONFIG (test isolation or custom config location)
 * 2. process.env.HOME (backward compatibility with existing test patterns)
 * 3. os.homedir() (default)
 *
 * Note: In tests, NORI_GLOBAL_CONFIG is preferred over HOME because it's
 * more explicit and avoids potential conflicts with system HOME.
 *
 * @returns Home directory path
 */
export const getHomeDir = (): string => {
  return process.env.NORI_GLOBAL_CONFIG ?? process.env.HOME ?? os.homedir();
};
