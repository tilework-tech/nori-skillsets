/**
 * JSONL parser for watch command
 *
 * Extracts session information from Claude Code JSONL files.
 */

import * as fs from "fs/promises";

/**
 * Regex to extract sessionId from JSONL without full JSON parsing
 * Matches: "sessionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" (UUID format)
 */
const SESSION_ID_REGEX =
  /"sessionId"\s*:\s*"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/;

/**
 * Extract sessionId from a JSONL file
 *
 * Uses regex for fast extraction without full JSON parsing.
 * Returns the first valid sessionId found in the file.
 *
 * @param args - Configuration arguments
 * @param args.filePath - Path to the JSONL file
 *
 * @returns The sessionId if found, null otherwise
 */
export const extractSessionId = async (args: {
  filePath: string;
}): Promise<string | null> => {
  const { filePath } = args;

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    // File doesn't exist or can't be read
    return null;
  }

  if (!content.trim()) {
    return null;
  }

  // Split into lines and search for sessionId
  const lines = content.split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const match = SESSION_ID_REGEX.exec(line);
    if (match != null && match[1] != null) {
      return match[1];
    }
  }

  return null;
};
