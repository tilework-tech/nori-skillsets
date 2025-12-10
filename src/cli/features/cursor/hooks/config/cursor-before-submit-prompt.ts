/**
 * Cursor beforeSubmitPrompt hook adapter
 * Transforms Cursor input format to Claude Code UserPromptSubmit format
 * and routes to the existing slash command interceptor
 */

import { interceptedSlashCommands } from "@/cli/features/hooks/config/intercepted-slashcommands/registry.js";

import type {
  HookInput,
  HookOutput,
} from "@/cli/features/hooks/config/intercepted-slashcommands/types.js";

/**
 * Cursor beforeSubmitPrompt input format
 */
export type CursorBeforeSubmitPromptInput = {
  conversation_id: string;
  generation_id: string;
  model: string;
  hook_event_name: string;
  cursor_version: string;
  workspace_roots: Array<string>;
  user_email: string;
  prompt: string;
  attachments: Array<{
    type: string;
    filePath?: string;
  }>;
};

/**
 * Cursor beforeSubmitPrompt output format
 */
export type CursorBeforeSubmitPromptOutput = {
  continue: boolean;
  user_message?: string | null;
};

/**
 * Transform Cursor input to Claude Code HookInput format
 * @param args - Arguments object
 * @param args.input - Cursor input
 *
 * @returns Claude Code HookInput format
 */
export const transformCursorInput = (args: {
  input: CursorBeforeSubmitPromptInput;
}): HookInput => {
  const { input } = args;

  return {
    prompt: input.prompt,
    cwd: input.workspace_roots[0] || process.cwd(),
    session_id: input.conversation_id,
    transcript_path: "", // Cursor doesn't provide transcript path
    permission_mode: "default",
    hook_event_name: "UserPromptSubmit", // Map to Claude Code event name
  };
};

/**
 * Transform Claude Code output to Cursor output format
 * @param args - Arguments object
 * @param args.output - Claude Code output (or null)
 *
 * @returns Cursor output format
 */
export const transformOutput = (args: {
  output: HookOutput | null;
}): CursorBeforeSubmitPromptOutput => {
  const { output } = args;

  if (output == null) {
    return { continue: true };
  }

  if (output.decision === "block") {
    return {
      continue: false,
      user_message: output.reason,
    };
  }

  // For hookSpecificOutput or other outputs, continue with the prompt
  return { continue: true };
};

/**
 * Main hook function
 */
const main = async (): Promise<void> => {
  // Read stdin
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const inputStr = Buffer.concat(chunks).toString("utf-8");

  // Parse input JSON
  let cursorInput: CursorBeforeSubmitPromptInput;
  try {
    if (!inputStr.trim()) {
      // Empty stdin - continue with prompt
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }
    cursorInput = JSON.parse(inputStr);
  } catch {
    // Invalid JSON - continue with prompt
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  const { prompt } = cursorInput;

  if (!prompt) {
    // No prompt - continue
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  // Transform to Claude Code format
  const claudeInput = transformCursorInput({ input: cursorInput });

  // Try each registered command
  for (const command of interceptedSlashCommands) {
    // Check if any matcher matches the prompt
    const trimmedPrompt = prompt.trim();
    let matched = false;

    for (const matcher of command.matchers) {
      const regex = new RegExp(matcher, "i");
      if (regex.test(trimmedPrompt)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      // Execute the command
      const result = await command.run({ input: claudeInput });

      // Transform output to Cursor format
      const cursorOutput = transformOutput({ output: result });
      console.log(JSON.stringify(cursorOutput));
      process.exit(0);
    }
  }

  // No matching command - continue with prompt
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
};

main().catch(() => {
  // Unexpected error - continue with prompt
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
