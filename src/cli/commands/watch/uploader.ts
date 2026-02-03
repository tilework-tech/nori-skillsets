/**
 * Transcript uploader
 *
 * Handles reading, parsing, and uploading transcripts to the registry.
 */

import * as fs from "fs/promises";

import { transcriptApi } from "@/api/transcript.js";
import { debug, error as logError } from "@/cli/logger.js";

import type { TranscriptMessage } from "@/api/transcript.js";

/**
 * Parse a JSONL transcript file into an array of messages
 *
 * @param args - Configuration arguments
 * @param args.content - Raw file content
 *
 * @returns Array of parsed messages (skips invalid lines)
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
    } catch {
      // Skip invalid JSON lines
      debug({ message: `Skipping invalid JSON line in transcript` });
    }
  }

  return messages;
};

/**
 * Extract sessionId from transcript messages
 *
 * @param args - Configuration arguments
 * @param args.messages - Parsed transcript messages
 *
 * @returns Session ID or null if not found
 */
const extractSessionId = (args: {
  messages: Array<TranscriptMessage>;
}): string | null => {
  const { messages } = args;

  for (const msg of messages) {
    if (msg.sessionId) {
      return msg.sessionId;
    }
  }

  return null;
};

/**
 * Process a transcript file for upload
 *
 * Reads the transcript, extracts sessionId, uploads to registry,
 * and deletes local files on success.
 *
 * @param args - Configuration arguments
 * @param args.transcriptPath - Path to the .jsonl transcript file
 * @param args.markerPath - Optional path to the .done marker file
 *
 * @returns True if upload succeeded, false otherwise
 */
export const processTranscriptForUpload = async (args: {
  transcriptPath: string;
  markerPath?: string | null;
}): Promise<boolean> => {
  const { transcriptPath, markerPath } = args;

  // Read transcript file
  let content: string;
  try {
    content = await fs.readFile(transcriptPath, "utf-8");
  } catch (err) {
    debug({ message: `Failed to read transcript: ${transcriptPath}` });
    return false;
  }

  // Parse transcript
  const messages = parseTranscript({ content });

  if (messages.length === 0) {
    debug({ message: `Transcript has no valid messages: ${transcriptPath}` });
    return false;
  }

  // Extract sessionId
  const sessionId = extractSessionId({ messages });

  if (sessionId == null) {
    debug({ message: `Transcript has no sessionId: ${transcriptPath}` });
    return false;
  }

  // Upload transcript
  try {
    await transcriptApi.upload({
      sessionId,
      messages,
    });

    debug({ message: `Uploaded transcript: ${sessionId}` });

    // Delete local files on success
    try {
      await fs.unlink(transcriptPath);
      debug({ message: `Deleted transcript file: ${transcriptPath}` });
    } catch {
      // Log but don't fail - upload succeeded
      debug({ message: `Failed to delete transcript file: ${transcriptPath}` });
    }

    if (markerPath != null) {
      try {
        await fs.unlink(markerPath);
        debug({ message: `Deleted marker file: ${markerPath}` });
      } catch {
        // Log but don't fail - upload succeeded
        debug({ message: `Failed to delete marker file: ${markerPath}` });
      }
    }

    return true;
  } catch (err) {
    logError({
      message: `Failed to upload transcript ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    // Preserve files on failure
    return false;
  }
};
