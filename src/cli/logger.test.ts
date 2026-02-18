import * as fs from "fs";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  setSilentMode,
  isSilentMode,
  debug,
  LOG_FILE,
  green,
  red,
  yellow,
  bold,
  brightCyan,
  boldWhite,
  gray,
  wrapText,
} from "@/cli/logger.js";

describe("logger silent mode", () => {
  beforeEach(() => {
    setSilentMode({ silent: false });
  });

  afterEach(() => {
    setSilentMode({ silent: false });
  });

  it("should have silent mode disabled by default", () => {
    expect(isSilentMode()).toBe(false);
  });

  it("should enable silent mode when setSilentMode is called with true", () => {
    setSilentMode({ silent: true });
    expect(isSilentMode()).toBe(true);
  });

  it("should disable silent mode when setSilentMode is called with false", () => {
    setSilentMode({ silent: true });
    setSilentMode({ silent: false });
    expect(isSilentMode()).toBe(false);
  });
});

describe("logger file output", () => {
  beforeEach(() => {
    setSilentMode({ silent: false });
  });

  afterEach(() => {
    setSilentMode({ silent: false });
  });

  it("should export LOG_FILE as /tmp/nori.log", () => {
    expect(LOG_FILE).toBe("/tmp/nori.log");
  });

  it("should write debug messages to log file with DEBUG level", async () => {
    const uniqueId = `debug-${Date.now()}-${Math.random()}`;
    debug({ message: uniqueId });
    // Give Winston time to flush to file
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    expect(content).toContain(uniqueId);
    expect(content).toContain("[DEBUG]");
  });
});

describe("color helpers", () => {
  it("should wrap text in green", () => {
    const result = green({ text: "hello" });
    expect(result).toContain("hello");
    expect(result).toContain("\x1b[0;32m");
    expect(result).toContain("\x1b[0m");
  });

  it("should wrap text in red", () => {
    const result = red({ text: "error" });
    expect(result).toContain("error");
    expect(result).toContain("\x1b[0;31m");
    expect(result).toContain("\x1b[0m");
  });

  it("should wrap text in yellow", () => {
    const result = yellow({ text: "warning" });
    expect(result).toContain("warning");
    expect(result).toContain("\x1b[1;33m");
    expect(result).toContain("\x1b[0m");
  });

  it("should wrap text in bold", () => {
    const result = bold({ text: "important" });
    expect(result).toContain("important");
    expect(result).toContain("\x1b[1m");
  });

  it("should wrap text in bright cyan", () => {
    const result = brightCyan({ text: "highlight" });
    expect(result).toContain("highlight");
    expect(result).toContain("\x1b[96m");
    expect(result).toContain("\x1b[0m");
  });

  it("should wrap text in bold white", () => {
    const result = boldWhite({ text: "option" });
    expect(result).toContain("option");
    expect(result).toContain("\x1b[1;37m");
    expect(result).toContain("\x1b[0m");
  });

  it("should wrap text in gray", () => {
    const result = gray({ text: "description" });
    expect(result).toContain("description");
    expect(result).toContain("\x1b[90m");
    expect(result).toContain("\x1b[0m");
  });
});

describe("wrapText", () => {
  it("should wrap text at specified width", () => {
    const result = wrapText({ text: "hello world foo bar", maxWidth: 10 });
    expect(result).toContain("\n");
  });

  it("should not wrap short text", () => {
    const result = wrapText({ text: "hello", maxWidth: 80 });
    expect(result).toBe("hello");
  });

  it("should handle empty text", () => {
    const result = wrapText({ text: "", maxWidth: 80 });
    expect(result).toBe("");
  });
});
