#!/usr/bin/env node

/**
 * Hook handler for summarizing conversations and storing them in Nori Profiles
 *
 * This script is called by Claude Code hooks on SessionEnd and PreCompact events.
 * It summarizes the conversation context and stores it using the backend API.
 */

import { apiClient, ConfigManager } from "@/api/index.js";
import { loadConfig } from "@/cli/config.js";
import { debug, error } from "@/cli/logger.js";
import { getInstallDirs } from "@/utils/path.js";

type TranscriptMessage = {
  type: string;
  message?: {
    role?: string;
    content?:
      | string
      | Array<{ type: string; text?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  summary?: string;
  [key: string]: unknown;
};

/**
 * Parse newline-delimited JSON transcript
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
      // Skip invalid JSON lines (but log in debug mode)
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
      if (item.type === "text" && (item as { text?: string }).text) {
        return (item as { text?: string }).text!.trim().length > 0;
      }
      return false;
    });
  }

  return false;
};

/**
 * Check if transcript is empty (contains no meaningful conversation)
 * A transcript is meaningful only if it has at least one user message with actual content.
 * @param args - Configuration arguments
 * @param args.content - Raw transcript content
 *
 * @returns True if transcript has no meaningful messages, false otherwise
 */
export const isEmptyTranscript = (args: { content: string }): boolean => {
  const { content } = args;

  if (!content || !content.trim()) {
    return true;
  }

  const messages = parseTranscript({ content });

  // Check for any user messages with content
  // Only user messages count as meaningful - assistant messages, tool use, hooks do not
  const hasUserMessages = messages.some((msg) => {
    // Only check for user messages
    if (msg.type === "user" && msg.message) {
      return hasContent({ content: msg.message.content });
    }

    return false;
  });

  return !hasUserMessages;
};

/**
 * Read transcript file and return entire conversation
 * @param args - Configuration arguments
 * @param args.transcriptPath - Path to transcript file
 *
 * @returns Transcript content as string
 */
const readTranscript = async (args: {
  transcriptPath: string;
}): Promise<string> => {
  const { transcriptPath } = args;
  const fs = await import("fs/promises");
  const content = await fs.readFile(transcriptPath, "utf-8");
  return content;
};

/**
 * Summarize and store conversation data
 * @param args - Configuration arguments
 * @param args.conversationData - Conversation transcript data
 */
const summarizeConversation = async (args: {
  conversationData: string;
}): Promise<void> => {
  const { conversationData } = args;

  // Check if Nori is configured
  if (!ConfigManager.isConfigured()) {
    error({
      message:
        "Nori hook: Not configured. Skipping memorization. Set credentials in ~/nori-config.json",
    });
    return;
  }

  // Check if session transcripts are enabled
  // Find installation directory using getInstallDirs
  const allInstallations = getInstallDirs({ currentDir: process.cwd() });

  if (allInstallations.length === 0) {
    error({
      message: "Nori hook: No Nori installation found. Skipping memorization.",
    });
    return;
  }

  const installDir = allInstallations[0]; // Use closest installation
  const diskConfig = await loadConfig({ installDir });
  if (diskConfig?.sendSessionTranscript === "disabled") {
    console.log(
      JSON.stringify({
        systemMessage:
          "Session Transcript disabled. Edit .nori-config.json to set sendSessionTranscript to reenable.",
      }),
    );
    debug({
      message: "Session transcripts disabled in config, skipping",
    });
    return;
  }

  // Parse conversation data to extract transcript path
  let transcriptContent: string | null = null;

  try {
    const data = JSON.parse(conversationData);

    // Read transcript file if available
    if (data.transcript_path) {
      transcriptContent = await readTranscript({
        transcriptPath: data.transcript_path,
      });
    }
  } catch (err) {
    error({
      message: `Nori hook: Failed to read transcript (non-fatal): ${err}`,
    });
    // Fall back to using raw conversation data
    transcriptContent = conversationData;
  }

  if (!transcriptContent) {
    error({ message: "Nori hook: No transcript content available" });
    return;
  }

  // Check if transcript is empty (only metadata, no user messages)
  if (isEmptyTranscript({ content: transcriptContent })) {
    debug({
      message:
        "Nori hook: Transcript is empty (no user messages), skipping memorization",
    });
    return;
  }

  try {
    // Call the backend to summarize and store
    await apiClient.conversation.summarize({
      content: transcriptContent,
    });
  } catch (err) {
    error({
      message: "Nori hook: Failed to summarize conversation (non-fatal)",
    });
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
  debug({ message: "=== Hook execution started ===" });

  // Get event type from command line arguments
  const eventType = process.argv[2];

  if (!eventType) {
    debug({ message: "ERROR: Event type is required" });
    error({ message: "Nori hook: Event type is required" });
    error({
      message:
        "Usage: summarize.ts <SessionEnd|PreCompact> [conversation-data]",
    });
    return;
  }

  if (eventType !== "SessionEnd" && eventType !== "PreCompact") {
    debug({
      message: `ERROR: Invalid event type "${eventType}"`,
    });
    error({
      message: `Nori hook: Invalid event type "${eventType}". Must be "SessionEnd" or "PreCompact"`,
    });
    return;
  }

  debug({ message: `Event type: ${eventType}` });

  // Read conversation data from stdin or command line
  let conversationData = process.argv[3] || "";

  if (!conversationData) {
    // Read from stdin if no argument provided
    debug({ message: "Reading conversation data from stdin" });
    const chunks: Array<Buffer> = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    conversationData = Buffer.concat(chunks).toString("utf-8");
  } else {
    debug({
      message: "Using conversation data from command line argument",
    });
  }

  debug({
    message: `Conversation data length: ${conversationData.length} bytes`,
  });

  if (!conversationData.trim()) {
    debug({ message: "ERROR: No conversation data provided" });
    error({
      message:
        "Nori hook: No conversation data provided, skipping memorization",
    });
    return;
  }

  await summarizeConversation({ conversationData });

  debug({ message: "Exit code: 0" });
  debug({ message: "=== Hook execution completed ===" });
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
