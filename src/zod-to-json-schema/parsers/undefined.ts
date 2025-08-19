import type { Refs } from "../Refs.js";
import { type JsonSchema7AnyType, parseAnyDef } from "./any.js";

export type JsonSchema7UndefinedType = {
  not: JsonSchema7AnyType;
};

export function parseUndefinedDef(refs: Refs): JsonSchema7UndefinedType {
  return {
    not: parseAnyDef(refs),
  };
}
