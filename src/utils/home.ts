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
 * 2. os.homedir() (supports test mocks and follows platform behavior)
 * 3. process.env.HOME (fallback when os.homedir is unavailable)
 *
 * Note: In tests, NORI_GLOBAL_CONFIG is preferred over HOME because it's
 * more explicit and avoids potential conflicts with system HOME.
 *
 * @returns Home directory path
 */
export const getHomeDir = (): string => {
  if (process.env.NORI_GLOBAL_CONFIG != null) {
    return process.env.NORI_GLOBAL_CONFIG;
  }

  const osHome = os.homedir();
  if (osHome.length > 0) {
    return osHome;
  }

  return process.env.HOME ?? osHome;
};
