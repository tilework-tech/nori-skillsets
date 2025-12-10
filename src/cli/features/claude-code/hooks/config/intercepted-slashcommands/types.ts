/**
 * Types for intercepted slash commands
 */

/**
 * Input from Claude Code hook stdin
 */
export type HookInput = {
  prompt: string;
  cwd: string;
  session_id: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: string;
};

/**
 * Output to Claude Code hook stdout
 */
export type HookOutput = {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
};

/**
 * Interface for intercepted slash commands
 */
export type InterceptedSlashCommand = {
  matchers: Array<string>; // regex patterns as strings
  run: (args: { input: HookInput }) => Promise<HookOutput | null>;
};
