/**
 * Slash command intercept hook for cursor-agent
 * Intercepts slash commands via Cursor's beforeSubmitPrompt hook
 * and executes them directly without LLM inference overhead.
 */

import * as os from "os";

import type {
  CursorHookInput,
  CursorHookOutput,
  HookInput,
  HookOutput,
} from "./intercepted-slashcommands/types.js";

import { interceptedSlashCommands } from "./intercepted-slashcommands/registry.js";

/**
 * Process Cursor's hook input into our internal format
 *
 * @param args - The function arguments
 * @param args.input - The Cursor hook input
 *
 * @returns The normalized internal hook input
 */
export const processInput = (args: { input: CursorHookInput }): HookInput => {
  const { input } = args;

  // Use first workspace_root as cwd, fall back to home directory
  const cwd =
    input.workspace_roots && input.workspace_roots.length > 0
      ? input.workspace_roots[0]
      : os.homedir();

  return {
    prompt: input.prompt,
    cwd,
    hook_event_name: input.hook_event_name,
    workspace_roots: input.workspace_roots,
  };
};

/**
 * Translate internal hook output to Cursor's expected format
 *
 * @param args - The function arguments
 * @param args.output - The internal hook output (or null for pass-through)
 *
 * @returns The Cursor hook output
 */
export const translateOutput = (args: {
  output: HookOutput | null;
}): CursorHookOutput => {
  const { output } = args;

  // Null output means pass-through (continue: true)
  if (output == null) {
    return { continue: true };
  }

  // If no decision, pass-through
  if (output.decision == null) {
    return { continue: true };
  }

  // Block decision means continue: false
  if (output.decision === "block") {
    return {
      continue: false,
      user_message: output.reason ?? undefined,
    };
  }

  // Default: pass-through
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

  // Parse input JSON (Cursor format)
  let cursorInput: CursorHookInput;
  try {
    if (!inputStr.trim()) {
      // Empty stdin - pass through
      console.log(JSON.stringify({ continue: true }));
      process.exit(0);
    }
    cursorInput = JSON.parse(inputStr);
  } catch {
    // Invalid JSON - pass through
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  const { prompt } = cursorInput;

  if (!prompt) {
    // Missing required field - pass through
    console.log(JSON.stringify({ continue: true }));
    process.exit(0);
  }

  // Convert to internal format
  const input = processInput({ input: cursorInput });

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
      const result = await command.run({ input });

      // Translate to Cursor format and output
      const cursorOutput = translateOutput({ output: result });
      console.log(JSON.stringify(cursorOutput));
      process.exit(0);
    }
  }

  // No matching command - pass through
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
};

main().catch(() => {
  // Unexpected error - pass through silently
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
