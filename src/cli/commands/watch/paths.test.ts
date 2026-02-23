/**
 * Tests for watch command path utilities
 */

import * as os from "os";
import * as path from "path";

import { describe, expect, test } from "vitest";

import {
  getTranscriptDir,
  getWatchPidFile,
  getWatchLogFile,
} from "@/cli/commands/watch/paths.js";

describe("getTranscriptDir", () => {
  test("returns correct path for claude-code agent", () => {
    const result = getTranscriptDir({
      agent: "claude-code",
      projectName: "-Users-sean-Projects-app",
    });
    const expected = path.join(
      os.homedir(),
      ".nori",
      "transcripts",
      "claude-code",
      "-Users-sean-Projects-app",
    );
    expect(result).toBe(expected);
  });

  test("returns correct path for different agent", () => {
    const result = getTranscriptDir({
      agent: "cursor",
      projectName: "-Users-sean-Projects-app",
    });
    const expected = path.join(
      os.homedir(),
      ".nori",
      "transcripts",
      "cursor",
      "-Users-sean-Projects-app",
    );
    expect(result).toBe(expected);
  });
});

describe("getWatchPidFile", () => {
  test("returns ~/.nori/watch.pid", () => {
    const result = getWatchPidFile();
    const expected = path.join(os.homedir(), ".nori", "watch.pid");
    expect(result).toBe(expected);
  });
});

describe("getWatchLogFile", () => {
  test("returns ~/.nori/logs/watch.log", () => {
    const result = getWatchLogFile();
    const expected = path.join(os.homedir(), ".nori", "logs", "watch.log");
    expect(result).toBe(expected);
  });
});
