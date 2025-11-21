import * as fs from "fs";
import * as path from "path";

import { afterAll, afterEach, beforeAll, vi } from "vitest";

// Set test environment
beforeAll(() => {
  process.env.NODE_ENV = "test";

  // Pre-test check: Verify CWD is clean (no .claude directory)
  // This catches test pollution from previous runs
  const cwdClaudePath = path.join(process.cwd(), ".claude");
  if (fs.existsSync(cwdClaudePath)) {
    throw new Error(
      `CONTAINMENT BREAK: .claude directory exists in CWD before tests run! ` +
        `This indicates test pollution from a previous run. ` +
        `Remove ${cwdClaudePath} and run tests again.`,
    );
  }
});

// Clean up resources after each test
afterEach(() => {
  // Clear all mocks between tests
  vi.clearAllMocks();
});

// Post-test check: Verify no .claude directory was created in CWD
afterAll(() => {
  const cwdClaudePath = path.join(process.cwd(), ".claude");
  if (fs.existsSync(cwdClaudePath)) {
    // Clean up before throwing to avoid polluting next run
    try {
      fs.rmSync(cwdClaudePath, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
    throw new Error(
      `CONTAINMENT BREAK: Tests created .claude directory in CWD! ` +
        `This means a test leaked installation files outside temp directories. ` +
        `All integration tests must mock HOME or installDir to point to temp directories.`,
    );
  }
});
