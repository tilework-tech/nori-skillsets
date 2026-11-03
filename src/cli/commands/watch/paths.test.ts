/**
 * Tests for watch command path utilities
 */

import * as os from "os";
import * as path from "path";

import { describe, expect, test } from "vitest";

import {
  getWatchPidFile,
  getWatchLogFile,
} from "@/cli/commands/watch/paths.js";

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
