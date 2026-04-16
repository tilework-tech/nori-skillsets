/**
 * Entry script for `node --import`. Registers moduleLoadTracer.mjs as an ESM
 * loader hook so all subsequently-loaded modules are written to the
 * $NORI_LOAD_TRACE file.
 */
import { register } from "node:module";

register("./moduleLoadTracer.mjs", import.meta.url);
