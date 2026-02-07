/**
 * Transcript Registry
 *
 * SQLite-based registry for tracking uploaded transcripts.
 * Stores sessionId, file hash, and upload timestamp to detect
 * which transcripts have already been uploaded and whether
 * the content has changed.
 */

import Database from "better-sqlite3";

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Registry for tracking uploaded transcripts using SQLite
 */
export class TranscriptRegistry {
  private db: DatabaseType;

  /**
   * Create a new TranscriptRegistry instance
   *
   * @param args - Configuration arguments
   * @param args.dbPath - Path to the SQLite database file
   */
  constructor(args: { dbPath: string }) {
    const { dbPath } = args;

    this.db = new Database(dbPath);

    // Create table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS uploads (
        session_id TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        transcript_path TEXT NOT NULL
      )
    `);
  }

  /**
   * Check if a transcript has been uploaded with the given hash
   *
   * @param args - Configuration arguments
   * @param args.sessionId - The session ID to check
   * @param args.fileHash - The hash of the file content
   *
   * @returns True if already uploaded with the same hash, false otherwise
   */
  isUploaded(args: { sessionId: string; fileHash: string }): boolean {
    const { sessionId, fileHash } = args;

    const row = this.db
      .prepare("SELECT file_hash FROM uploads WHERE session_id = ?")
      .get(sessionId) as { file_hash: string } | undefined;

    if (row == null) {
      return false;
    }

    // Return true only if the hash matches (same content)
    return row.file_hash === fileHash;
  }

  /**
   * Mark a transcript as uploaded
   *
   * @param args - Configuration arguments
   * @param args.sessionId - The session ID
   * @param args.fileHash - The hash of the file content
   * @param args.transcriptPath - The path to the transcript file
   */
  markUploaded(args: {
    sessionId: string;
    fileHash: string;
    transcriptPath: string;
  }): void {
    const { sessionId, fileHash, transcriptPath } = args;

    const now = Date.now();

    // Use INSERT OR REPLACE to handle updates
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO uploads (session_id, file_hash, uploaded_at, transcript_path)
        VALUES (?, ?, ?, ?)
      `,
      )
      .run(sessionId, fileHash, now, transcriptPath);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
