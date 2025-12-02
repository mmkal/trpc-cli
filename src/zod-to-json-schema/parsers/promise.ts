import type { ZodPromiseDef } from "zod/v3";
import { parseDef } from "../parseDef.js";
import type { JsonSchema7Type } from "../parseTypes.js";
import type { Refs } from "../Refs.js";

export function parsePromiseDef(
  def: ZodPromiseDef,
  refs: Refs,
): JsonSchema7Type | undefined {
  return parseDef(def.type._def, refs);
}
