import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  findCursorDatabase,
  extractMessages,
  formatForBackend,
} from "./cursor-chat-extractor";

describe("cursor-chat-extractor", () => {
  let tmpDir: string;
  let cursorChatsDir: string;

  beforeEach(async () => {
    // Create temp directory for test databases
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-test-"));
    cursorChatsDir = path.join(tmpDir, ".cursor", "chats");
    await fs.mkdir(cursorChatsDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("findCursorDatabase", () => {
    it("should find database with matching conversation_id", async () => {
      const conversationId = "test-conversation-123";
      const workspaceHash = "workspace-abc";
      const dbDir = path.join(cursorChatsDir, workspaceHash, conversationId);
      await fs.mkdir(dbDir, { recursive: true });

      const dbPath = path.join(dbDir, "store.db");
      const db = new Database(dbPath);
      db.close();

      const result = await findCursorDatabase({
        conversationId,
        cursorChatsDir,
      });

      expect(result).toBe(dbPath);
    });

    it("should return most recently modified database when multiple exist", async () => {
      const conversationId = "test-conversation-456";

      // Create first database
      const workspace1 = path.join(
        cursorChatsDir,
        "workspace-1",
        conversationId,
      );
      await fs.mkdir(workspace1, { recursive: true });
      const db1Path = path.join(workspace1, "store.db");
      const db1 = new Database(db1Path);
      db1.close();

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create second database (more recent)
      const workspace2 = path.join(
        cursorChatsDir,
        "workspace-2",
        conversationId,
      );
      await fs.mkdir(workspace2, { recursive: true });
      const db2Path = path.join(workspace2, "store.db");
      const db2 = new Database(db2Path);
      db2.close();

      const result = await findCursorDatabase({
        conversationId,
        cursorChatsDir,
      });

      expect(result).toBe(db2Path);
    });

    it("should throw error when conversation_id not found", async () => {
      await expect(
        findCursorDatabase({
          conversationId: "nonexistent-id",
          cursorChatsDir,
        }),
      ).rejects.toThrow("Could not find Cursor database");
    });

    it("should throw error when chats directory does not exist", async () => {
      await expect(
        findCursorDatabase({
          conversationId: "test-id",
          cursorChatsDir: "/nonexistent/path",
        }),
      ).rejects.toThrow();
    });
  });

  describe("extractMessages", () => {
    it("should extract messages from SQLite database", async () => {
      const dbPath = path.join(tmpDir, "test.db");
      const db = new Database(dbPath);

      // Create schema
      db.exec(`
        CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      `);

      // Insert test messages as JSON blobs
      const message1 = JSON.stringify({
        role: "user",
        content: "Hello, Cursor!",
      });
      const message2 = JSON.stringify({
        role: "assistant",
        content: "Hello! How can I help you?",
      });

      db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run(
        "blob-1",
        Buffer.from(message1, "utf-8"),
      );
      db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run(
        "blob-2",
        Buffer.from(message2, "utf-8"),
      );

      db.close();

      const messages = await extractMessages({ dbPath });

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "Hello, Cursor!",
      });
      expect(messages[1]).toMatchObject({
        role: "assistant",
        content: "Hello! How can I help you?",
      });
    });

    it("should handle binary data gracefully", async () => {
      const dbPath = path.join(tmpDir, "binary.db");
      const db = new Database(dbPath);

      db.exec(`
        CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      `);

      // Insert binary data that's not valid UTF-8 JSON
      const binaryData = Buffer.from([0xff, 0xfe, 0xfd, 0xfc]);
      db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)").run(
        "blob-binary",
        binaryData,
      );

      db.close();

      const messages = await extractMessages({ dbPath });

      // Should still extract something, even if it's raw/encoded
      expect(messages).toHaveLength(1);
    });

    it("should handle empty database", async () => {
      const dbPath = path.join(tmpDir, "empty.db");
      const db = new Database(dbPath);

      db.exec(`
        CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      `);

      db.close();

      const messages = await extractMessages({ dbPath });

      expect(messages).toEqual([]);
    });

    it("should throw error for nonexistent database file", async () => {
      await expect(
        extractMessages({ dbPath: "/nonexistent/path/db.sqlite" }),
      ).rejects.toThrow();
    });
  });

  describe("formatForBackend", () => {
    it("should convert messages to NDJSON format", () => {
      const messages = [
        { role: "user", content: "First message" },
        { role: "assistant", content: "Second message" },
      ];

      const result = formatForBackend({ messages });

      const lines = result.trim().split("\n");
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]);
      expect(parsed1).toMatchObject({
        type: "user",
        message: {
          role: "user",
          content: "First message",
        },
      });

      const parsed2 = JSON.parse(lines[1]);
      expect(parsed2).toMatchObject({
        type: "assistant",
        message: {
          role: "assistant",
          content: "Second message",
        },
      });
    });

    it("should handle empty messages array", () => {
      const result = formatForBackend({ messages: [] });
      expect(result).toBe("");
    });

    it("should filter out messages without content", () => {
      const messages = [
        { role: "user", content: "Valid message" },
        { role: "user", content: "" }, // Empty content
        { role: "assistant" }, // No content field
        { role: "user", content: "Another valid message" },
      ];

      const result = formatForBackend({ messages });

      const lines = result.trim().split("\n");
      expect(lines).toHaveLength(2); // Only 2 valid messages
    });
  });
});
