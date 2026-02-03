#!/usr/bin/env node

/**
 * Transcript Done Marker Hook
 *
 * This hook runs at SessionEnd and writes a .done marker file
 * to signal that a session has completed and is ready for upload.
 *
 * The watch daemon monitors for these markers and triggers immediate upload.
 */

import * as fs from "fs/promises";
import * as path from "path";

import { debug } from "@/cli/logger.js";

/**
 * Write a .done marker file for a transcript
 *
 * @param args - Configuration arguments
 * @param args.transcriptPath - Path to the transcript file
 * @param args.sessionId - Session ID for the marker filename
 */
export const writeTranscriptDoneMarker = async (args: {
  transcriptPath: string;
  sessionId: string;
}): Promise<void> => {
  const { transcriptPath, sessionId } = args;

  try {
    // Get the directory of the transcript file
    const dir = path.dirname(transcriptPath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write empty marker file
    const markerPath = path.join(dir, `${sessionId}.done`);
    await fs.writeFile(markerPath, "");

    debug({ message: `Wrote transcript done marker: ${markerPath}` });
  } catch (err) {
    // Don't throw - this hook should never crash the session
    debug({
      message: `Failed to write transcript done marker: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

/**
 * Extract sessionId from a transcript file using regex
 *
 * @param args - Configuration arguments
 * @param args.content - Transcript file content
 *
 * @returns Session ID or null if not found
 */
const extractSessionIdFromContent = (args: {
  content: string;
}): string | null => {
  const { content } = args;

  // Match UUID format sessionId
  const regex =
    /"sessionId"\s*:\s*"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/;
  const match = content.match(regex);

  return match ? match[1] : null;
};

/**
 * Main entry point for the hook
 */
const main = async (): Promise<void> => {
  debug({ message: "=== Transcript done marker hook started ===" });

  // Read conversation data from stdin
  let inputData = "";
  const chunks: Array<Buffer> = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  inputData = Buffer.concat(chunks).toString("utf-8");

  if (!inputData.trim()) {
    debug({ message: "No input data provided, exiting" });
    return;
  }

  // Parse input to get transcript_path
  let transcriptPath: string | null = null;
  try {
    const data = JSON.parse(inputData);
    transcriptPath = data.transcript_path;
  } catch {
    debug({ message: "Failed to parse input JSON" });
    return;
  }

  if (transcriptPath == null) {
    debug({ message: "No transcript_path in input" });
    return;
  }

  // Read transcript to extract sessionId
  let transcriptContent: string;
  try {
    transcriptContent = await fs.readFile(transcriptPath, "utf-8");
  } catch {
    debug({ message: `Failed to read transcript: ${transcriptPath}` });
    return;
  }

  const sessionId = extractSessionIdFromContent({ content: transcriptContent });

  if (sessionId == null) {
    debug({ message: "No sessionId found in transcript" });
    return;
  }

  // Determine the transcript storage path
  // Claude Code transcripts are at ~/.claude/projects/{project}/{session}.jsonl
  // We store at ~/.nori/transcripts/claude-code/{project}/{sessionId}.jsonl
  const homeDir = process.env.HOME ?? "";
  const claudeProjectsDir = path.join(homeDir, ".claude", "projects");
  const relativePath = path.relative(claudeProjectsDir, transcriptPath);
  const projectName = relativePath.split(path.sep)[0];

  if (projectName == null || projectName === "") {
    debug({ message: "Could not determine project name from transcript path" });
    return;
  }

  // Build the path to our transcript storage location
  const noriTranscriptDir = path.join(
    homeDir,
    ".nori",
    "transcripts",
    "claude-code",
    projectName,
  );
  const noriTranscriptPath = path.join(noriTranscriptDir, `${sessionId}.jsonl`);

  // Write the marker
  await writeTranscriptDoneMarker({
    transcriptPath: noriTranscriptPath,
    sessionId,
  });

  debug({ message: "=== Transcript done marker hook completed ===" });
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // Never crash the session
    debug({ message: `Transcript done marker hook error: ${err}` });
    process.exit(0);
  });
}
