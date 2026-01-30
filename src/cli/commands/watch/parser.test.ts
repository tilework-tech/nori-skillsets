/**
 * Tests for watch command JSONL parser
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { extractSessionId } from "@/cli/commands/watch/parser.js";

describe("extractSessionId", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "parser-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("extracts sessionId from JSONL file with user message", async () => {
    const filePath = path.join(tempDir, "session.jsonl");
    const content = `{"type":"summary","summary":"Test session"}
{"parentUuid":null,"sessionId":"009aa36e-7ab0-46b5-bc99-b9ace7e41f0c","type":"user","message":{"role":"user","content":"Hello"}}`;

    await fs.writeFile(filePath, content, "utf-8");

    const result = await extractSessionId({ filePath });
    expect(result).toBe("009aa36e-7ab0-46b5-bc99-b9ace7e41f0c");
  });

  test("extracts sessionId from first line containing it", async () => {
    const filePath = path.join(tempDir, "session.jsonl");
    const content = `{"type":"file-history-snapshot","messageId":"abc"}
{"sessionId":"11111111-2222-3333-4444-555555555555","type":"user"}
{"sessionId":"99999999-8888-7777-6666-555555555555","type":"assistant"}`;

    await fs.writeFile(filePath, content, "utf-8");

    const result = await extractSessionId({ filePath });
    expect(result).toBe("11111111-2222-3333-4444-555555555555");
  });

  test("returns null for file without sessionId", async () => {
    const filePath = path.join(tempDir, "no-session.jsonl");
    const content = `{"type":"summary","summary":"No session here"}
{"type":"file-history-snapshot","messageId":"abc"}`;

    await fs.writeFile(filePath, content, "utf-8");

    const result = await extractSessionId({ filePath });
    expect(result).toBeNull();
  });

  test("returns null for empty file", async () => {
    const filePath = path.join(tempDir, "empty.jsonl");
    await fs.writeFile(filePath, "", "utf-8");

    const result = await extractSessionId({ filePath });
    expect(result).toBeNull();
  });

  test("returns null for non-existent file", async () => {
    const filePath = path.join(tempDir, "does-not-exist.jsonl");

    const result = await extractSessionId({ filePath });
    expect(result).toBeNull();
  });

  test("handles malformed JSON lines gracefully", async () => {
    const filePath = path.join(tempDir, "malformed.jsonl");
    const content = `not valid json
{"sessionId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","type":"user"}`;

    await fs.writeFile(filePath, content, "utf-8");

    const result = await extractSessionId({ filePath });
    expect(result).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("validates UUID format", async () => {
    const filePath = path.join(tempDir, "invalid-uuid.jsonl");
    const content = `{"sessionId":"not-a-valid-uuid","type":"user"}
{"sessionId":"12345678-1234-1234-1234-123456789abc","type":"assistant"}`;

    await fs.writeFile(filePath, content, "utf-8");

    const result = await extractSessionId({ filePath });
    // Should skip invalid UUID and find the valid one
    expect(result).toBe("12345678-1234-1234-1234-123456789abc");
  });
});
