/**
 * Cursor chat extractor module
 * Extracts chat transcripts from Cursor's SQLite databases
 */

import * as fs from "fs/promises";
import * as path from "path";

import Database from "better-sqlite3";

type CursorMessage = {
  role?: string;
  content?: string;
  [key: string]: unknown;
};

/**
 * Find Cursor database for a given conversation_id
 *
 * @param args - Configuration arguments
 * @param args.conversationId - Conversation ID from stop hook
 * @param args.cursorChatsDir - Path to .cursor/chats directory
 *
 * @returns Path to store.db file
 */
export const findCursorDatabase = async (args: {
  conversationId: string;
  cursorChatsDir: string;
}): Promise<string> => {
  const { conversationId, cursorChatsDir } = args;

  // Validate conversation_id doesn't contain path traversal characters
  if (
    conversationId.includes("..") ||
    conversationId.includes("/") ||
    conversationId.includes("\\")
  ) {
    throw new Error(
      `Invalid conversation ID: contains path traversal characters`,
    );
  }

  // Read all workspace directories
  const workspaceDirs = await fs.readdir(cursorChatsDir);

  // Find all store.db files matching conversation_id
  const candidates: Array<{ path: string; mtime: number }> = [];

  for (const workspaceHash of workspaceDirs) {
    // Validate workspace hash doesn't contain path traversal
    if (
      workspaceHash.includes("..") ||
      workspaceHash.includes("/") ||
      workspaceHash.includes("\\")
    ) {
      continue; // Skip suspicious workspace directories
    }

    const conversationDir = path.join(
      cursorChatsDir,
      workspaceHash,
      conversationId,
    );

    // Verify resolved path is still within cursorChatsDir
    const resolvedPath = path.resolve(conversationDir);
    const resolvedChatsDir = path.resolve(cursorChatsDir);
    if (!resolvedPath.startsWith(resolvedChatsDir)) {
      throw new Error(`Path traversal detected: ${conversationId}`);
    }

    try {
      const dbPath = path.join(conversationDir, "store.db");

      // Verify dbPath is also within bounds
      const resolvedDbPath = path.resolve(dbPath);
      if (!resolvedDbPath.startsWith(resolvedChatsDir)) {
        throw new Error(`Path traversal detected in database path`);
      }

      const stats = await fs.stat(dbPath);

      if (stats.isFile()) {
        candidates.push({
          path: dbPath,
          mtime: stats.mtimeMs,
        });
      }
    } catch {
      // Directory doesn't exist or no store.db, skip
      continue;
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      `Could not find Cursor database for conversation ${conversationId}`,
    );
  }

  // Sort by modification time (most recent first)
  candidates.sort((a, b) => b.mtime - a.mtime);

  return candidates[0].path;
};

/**
 * Extract messages from Cursor SQLite database
 *
 * @param args - Configuration arguments
 * @param args.dbPath - Path to store.db file
 *
 * @returns Array of message objects
 */
export const extractMessages = async (args: {
  dbPath: string;
}): Promise<Array<CursorMessage>> => {
  const { dbPath } = args;

  const db = new Database(dbPath, { readonly: true });

  try {
    // Query all blobs
    const rows = db.prepare("SELECT id, data FROM blobs ORDER BY ROWID").all();

    const messages: Array<CursorMessage> = [];

    for (const row of rows as Array<{ id: string; data: Buffer }>) {
      try {
        // Try to decode as UTF-8 and parse as JSON
        const text = row.data.toString("utf-8");
        const parsed = JSON.parse(text) as CursorMessage;
        messages.push(parsed);
      } catch {
        // If parsing fails, store as raw text/binary
        // This handles binary data gracefully
        try {
          const text = row.data.toString("utf-8");
          messages.push({ role: "unknown", content: text });
        } catch {
          // If even UTF-8 decoding fails, skip this message
          // or we could base64 encode it
          const base64 = row.data.toString("base64");
          messages.push({ role: "binary", content: base64 });
        }
      }
    }

    return messages;
  } finally {
    db.close();
  }
};

/**
 * Format messages for backend API (NDJSON)
 *
 * @param args - Configuration arguments
 * @param args.messages - Array of cursor messages
 *
 * @returns Newline-delimited JSON string
 */
export const formatForBackend = (args: {
  messages: Array<CursorMessage>;
}): string => {
  const { messages } = args;

  const formattedLines = messages
    .filter((msg) => {
      // Filter out messages without content
      return msg.content != null && msg.content !== "";
    })
    .map((msg) => {
      // Convert to backend format
      const formatted = {
        type: msg.role ?? "unknown",
        message: {
          role: msg.role ?? "unknown",
          content: msg.content,
        },
      };

      return JSON.stringify(formatted);
    });

  return formattedLines.join("\n");
};
