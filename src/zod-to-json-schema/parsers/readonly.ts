import type { ZodReadonlyDef } from "zod/v3";
import { parseDef } from "../parseDef.js";
import type { Refs } from "../Refs.js";

export const parseReadonlyDef = (def: ZodReadonlyDef<any>, refs: Refs) => {
  return parseDef(def.innerType._def, refs);
};
