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
  env?: NodeJS.ProcessEnv | null;
}): boolean => {
  const stdin = args?.stdin ?? process.stdin;
  const env = args?.env ?? process.env;

  if (isTruthyEnvValue({ value: env.CI })) {
    return true;
  }

  if (stdin.isTTY !== true) {
    return true;
  }

  return false;
};
