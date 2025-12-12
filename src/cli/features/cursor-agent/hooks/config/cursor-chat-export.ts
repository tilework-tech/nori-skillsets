#!/usr/bin/env node

/**
 * Hook handler for exporting Cursor chat transcripts to Nori backend
 *
 * This script is called by Cursor hooks on the stop event.
 * It extracts chat messages from Cursor's SQLite database and uploads them.
 */

import * as os from "os";
import * as path from "path";

import { apiClient, ConfigManager } from "@/api/index.js";
import { loadConfig } from "@/cli/config.js";
import { debug, error } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

import {
  findCursorDatabase,
  extractMessages,
  formatForBackend,
} from "./cursor-chat-extractor.js";

type TranscriptMessage = {
  type: string;
  message?: {
    role?: string;
    content?:
      | string
      | Array<{ type: string; text?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Parse newline-delimited JSON transcript
 *
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns Array of parsed transcript messages
 */
const parseTranscript = (args: {
  content: string;
}): Array<TranscriptMessage> => {
  const { content } = args;
  const lines = content.trim().split("\n");
  const messages: Array<TranscriptMessage> = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line) as TranscriptMessage;
      messages.push(parsed);
    } catch (parseError) {
      debug({
        message: `Failed to parse transcript line: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }`,
      });
    }
  }

  return messages;
};

/**
 * Check if message content is non-empty
 *
 * @param args - Configuration arguments
 * @param args.content - Message content in various formats
 *
 * @returns True if content is meaningful, false if empty
 */
const hasContent = (args: {
  content:
    | string
    | Array<{ type: string; text?: string; [key: string]: unknown }>
    | undefined;
}): boolean => {
  const { content } = args;

  if (!content) return false;

  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (Array.isArray(content)) {
    return content.some((item) => {
      if (item.type === "text") {
        const text = (item as { text?: string }).text;
        return text != null && text.trim().length > 0;
      }
      return false;
    });
  }

  return false;
};

/**
 * Check if transcript is empty (contains no meaningful conversation)
 *
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns True if transcript has no meaningful messages, false otherwise
 */
export const isEmptyTranscript = (args: { content: string }): boolean => {
  const { content } = args;

  if (content == null || content.trim() === "") {
    return true;
  }

  const messages = parseTranscript({ content });

  // Check for any user messages with content
  const hasUserMessages = messages.some((msg) => {
    if (msg.type === "user" && msg.message) {
      return hasContent({ content: msg.message.content });
    }
    return false;
  });

  return !hasUserMessages;
};

/**
 * Export cursor chat transcript
 *
 * @param args - Configuration arguments
 * @param args.conversationId - Conversation ID from stop hook
 * @param args.status - Status from stop hook ("completed", "aborted", "error")
 */
export const exportCursorChat = async (args: {
  conversationId: string;
  status: string;
}): Promise<void> => {
  const { conversationId, status } = args;

  debug({ message: `Exporting cursor chat: ${conversationId} (${status})` });

  // Check if Nori is configured
  if (!ConfigManager.isConfigured()) {
    error({
      message:
        "Nori hook: Not configured. Skipping export. Set credentials in ~/nori-config.json",
    });
    return;
  }

  // Find installation directory
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    error({
      message: "Nori hook: No Nori installation found. Skipping export.",
    });
    return;
  }

  const installDir = allInstallations[0];
  const diskConfig = await loadConfig({ installDir });

  // Check if session transcripts are enabled
  if (diskConfig?.sendSessionTranscript === "disabled") {
    console.log(
      JSON.stringify({
        systemMessage:
          "Session Transcript disabled. Use /nori-toggle-session-transcripts to reenable",
      }),
    );
    debug({ message: "Session transcripts disabled in config, skipping" });
    return;
  }

  try {
    // Find Cursor database
    const cursorChatsDir = path.join(os.homedir(), ".cursor", "chats");
    const dbPath = await findCursorDatabase({
      conversationId,
      cursorChatsDir,
    });

    debug({ message: `Found database at: ${dbPath}` });

    // Extract messages from database
    const messages = await extractMessages({ dbPath });
    debug({ message: `Extracted ${messages.length} messages` });

    // Format for backend
    const transcriptContent = formatForBackend({ messages });

    // Check if transcript is empty
    if (isEmptyTranscript({ content: transcriptContent })) {
      debug({
        message:
          "Nori hook: Transcript is empty (no user messages), skipping export",
      });
      return;
    }

    // Upload to backend
    await apiClient.conversation.summarize({
      content: transcriptContent,
      actor: "cursor-agent",
    });

    debug({ message: "Successfully exported cursor chat to Nori" });
  } catch (err) {
    error({ message: "Nori hook: Failed to export cursor chat (non-fatal)" });
    if (err instanceof Error) {
      error({ message: `  ${err.message}` });
    } else {
      error({ message: `  ${JSON.stringify(err, null, 2)}` });
    }
    // Don't exit with error code - hooks should not crash the session
  }
};

/**
 * Main entry point
 */
const main = async (): Promise<void> => {
  debug({ message: "=== Cursor chat export hook execution started ===" });

  // Read stop hook data from stdin
  const chunks: Array<Buffer> = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const stdinData = Buffer.concat(chunks).toString("utf-8");

  debug({ message: `Received stdin data: ${stdinData}` });

  if (stdinData.trim() === "") {
    error({ message: "Nori hook: No data provided from Cursor stop hook" });
    return;
  }

  try {
    const hookData = JSON.parse(stdinData) as {
      conversation_id?: string;
      status?: string;
    };

    if (hookData.conversation_id == null) {
      error({
        message: "Nori hook: No conversation_id in stop hook data",
      });
      return;
    }

    await exportCursorChat({
      conversationId: hookData.conversation_id,
      status: hookData.status ?? "unknown",
    });
  } catch (err) {
    error({ message: "Nori hook: Failed to parse stop hook JSON" });
    if (err instanceof Error) {
      error({ message: `  ${err.message}` });
    }
  }

  debug({ message: "=== Cursor chat export hook execution completed ===" });
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Mark this hook as async so it runs in background
  console.log(JSON.stringify({ async: true }));

  main().catch((err) => {
    error({ message: "Nori hook: Unhandled error (non-fatal):" });
    error({ message: `Error name: ${err?.name}` });
    error({ message: `Error message: ${err?.message}` });
    error({ message: `Error stack: ${err?.stack}` });
    // Exit with 0 to avoid crashing the session
    process.exit(0);
  });
}
