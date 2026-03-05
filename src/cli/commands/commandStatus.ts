/**
 * Standard return type for CLI commands that participate in intro/outro framing.
 *
 * Commands return this status so the top-level caller (noriSkillsetsCommands.ts)
 * can render the appropriate outro message. Commands that don't need visual
 * framing (single-step, scriptable) can continue returning void.
 */
export type CommandStatus = {
  success: boolean;
  cancelled: boolean;
  message: string;
};
