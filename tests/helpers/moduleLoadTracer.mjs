/**
 * ESM loader hook that appends every loaded module URL to the file at
 * $NORI_LOAD_TRACE. Used by nori-skillsets.lazy-loading.test.ts to verify that
 * command handlers are only loaded when their command is invoked.
 */
import { appendFileSync } from "node:fs";

const traceFile = process.env.NORI_LOAD_TRACE;

export const load = async (url, context, nextLoad) => {
  if (traceFile != null && traceFile.length > 0) {
    appendFileSync(traceFile, `${url}\n`);
  }
  return nextLoad(url, context);
};
