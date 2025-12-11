/**
 * Types for cursor-agent intercepted slash commands
 */

/**
 * Input from Cursor beforeSubmitPrompt hook stdin
 * Based on https://cursor.com/docs/agent/hooks#beforesubmitprompt
 */
export type CursorHookInput = {
  prompt: string;
  attachments?: Array<{
    type: "file" | "rule";
    filePath: string;
  }>;
  // Base fields common to all Cursor hooks
  conversation_id?: string | null;
  generation_id?: string | null;
  model?: string | null;
  hook_event_name: string;
  cursor_version?: string | null;
  workspace_roots?: Array<string> | null;
  user_email?: string | null;
};

/**
 * Output to Cursor beforeSubmitPrompt hook stdout
 */
export type CursorHookOutput = {
  continue: boolean;
  user_message?: string | null;
};

/**
 * Internal hook input format (normalized from Cursor format)
 * Compatible with claude-code's HookInput for command reuse
 */
export type HookInput = {
  prompt: string;
  cwd: string;
  hook_event_name: string;
  // Optional fields for compatibility
  session_id?: string | null;
  workspace_roots?: Array<string> | null;
};

/**
 * Internal hook output format (before translation to Cursor format)
 */
export type HookOutput = {
  decision?: "block" | null;
  reason?: string | null;
};

/**
 * Interface for intercepted slash commands
 */
export type InterceptedSlashCommand = {
  matchers: Array<string>; // regex patterns as strings
  run: (args: { input: HookInput }) => Promise<HookOutput | null>;
};
