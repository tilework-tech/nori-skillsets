/**
 * Transcript storage for watch command
 *
 * Handles copying JSONL files to transcript storage location.
 */

import * as fs from "fs/promises";
import * as path from "path";

/**
 * Copy a JSONL transcript file to the destination directory
 *
 * @param args - Configuration arguments
 * @param args.sourceFile - Path to the source JSONL file
 * @param args.destDir - Destination directory for the transcript
 * @param args.sessionId - Session ID to use as the filename
 */
export const copyTranscript = async (args: {
  sourceFile: string;
  destDir: string;
  sessionId: string;
}): Promise<void> => {
  const { sourceFile, destDir, sessionId } = args;

  // Ensure destination directory exists
  await fs.mkdir(destDir, { recursive: true });

  // Copy the file
  const destFile = path.join(destDir, `${sessionId}.jsonl`);
  await fs.copyFile(sourceFile, destFile);
};
