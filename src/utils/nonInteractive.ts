const FALSY_STRINGS = new Set(["", "0", "false"]);

const isTruthyEnvValue = (args: {
  value: string | null | undefined;
}): boolean => {
  const { value } = args;
  if (value == null) {
    return false;
  }
  return !FALSY_STRINGS.has(value.toLowerCase());
};

export const isNonInteractiveEnvironment = (args?: {
  stdin?: { isTTY?: boolean | undefined } | null;
  stdout?: { isTTY?: boolean | undefined } | null;
  env?: NodeJS.ProcessEnv | null;
}): boolean => {
  const stdin = args?.stdin ?? process.stdin;
  const stdout = args?.stdout ?? process.stdout;
  const env = args?.env ?? process.env;

  if (isTruthyEnvValue({ value: env.CI })) {
    return true;
  }

  if (stdin.isTTY !== true) {
    return true;
  }

  // A non-TTY stdout means our output is being piped/captured (e.g. nori-cli
  // spawns `nori-skillsets list` and parses stdout line-by-line). Prompting
  // there would corrupt the captured output and block waiting for a keypress,
  // so treat a piped stdout as non-interactive even when stdin is a TTY.
  if (stdout.isTTY !== true) {
    return true;
  }

  return false;
};
