/**
 * Registry of intercepted slash commands for cursor-agent
 */

import type { InterceptedSlashCommand } from "./types.js";

import { noriSwitchProfile } from "./nori-switch-profile.js";

/**
 * List of all intercepted slash commands for cursor-agent
 * Commands are checked in order; first matching command wins
 */
export const interceptedSlashCommands: Array<InterceptedSlashCommand> = [
  noriSwitchProfile,
];
