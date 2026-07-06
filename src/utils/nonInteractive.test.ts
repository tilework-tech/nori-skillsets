import { describe, it, expect } from "vitest";

import { isNonInteractiveEnvironment } from "./nonInteractive.js";

const ttyStdin = { isTTY: true };
const pipedStdin = { isTTY: false };
const ttyStdout = { isTTY: true };
const pipedStdout = { isTTY: false };

describe("isNonInteractiveEnvironment", () => {
  it("returns true when CI is set to a truthy value", () => {
    expect(
      isNonInteractiveEnvironment({ env: { CI: "true" }, stdin: ttyStdin }),
    ).toBe(true);
    expect(
      isNonInteractiveEnvironment({ env: { CI: "1" }, stdin: ttyStdin }),
    ).toBe(true);
  });

  it("returns false when CI is set to a falsy string value", () => {
    expect(
      isNonInteractiveEnvironment({
        env: { CI: "" },
        stdin: ttyStdin,
        stdout: ttyStdout,
      }),
    ).toBe(false);
    expect(
      isNonInteractiveEnvironment({
        env: { CI: "0" },
        stdin: ttyStdin,
        stdout: ttyStdout,
      }),
    ).toBe(false);
    expect(
      isNonInteractiveEnvironment({
        env: { CI: "false" },
        stdin: ttyStdin,
        stdout: ttyStdout,
      }),
    ).toBe(false);
  });

  it("returns true when stdin is not a TTY", () => {
    expect(
      isNonInteractiveEnvironment({
        env: {},
        stdin: pipedStdin,
        stdout: ttyStdout,
      }),
    ).toBe(true);
  });

  it("returns true when stdin.isTTY is undefined", () => {
    expect(
      isNonInteractiveEnvironment({
        env: {},
        stdin: { isTTY: undefined },
        stdout: ttyStdout,
      }),
    ).toBe(true);
  });

  it("returns true when stdout is not a TTY even though stdin is a TTY", () => {
    // A parent process capturing our stdout (e.g. the nori TUI running
    // `nori-skillsets list` and parsing the output) inherits the terminal's
    // TTY stdin but pipes stdout. Rendering an interactive prompt here corrupts
    // the captured output and blocks forever waiting for a keypress.
    expect(
      isNonInteractiveEnvironment({
        env: {},
        stdin: ttyStdin,
        stdout: pipedStdout,
      }),
    ).toBe(true);
  });

  it("returns true when stdout.isTTY is undefined", () => {
    expect(
      isNonInteractiveEnvironment({
        env: {},
        stdin: ttyStdin,
        stdout: { isTTY: undefined },
      }),
    ).toBe(true);
  });

  it("returns false only when both stdin and stdout are TTYs and no interactive-blocking env is set", () => {
    expect(
      isNonInteractiveEnvironment({
        env: {},
        stdin: ttyStdin,
        stdout: ttyStdout,
      }),
    ).toBe(false);
  });
});
