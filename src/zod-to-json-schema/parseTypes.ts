import type { JsonSchema7AnyType } from "./parsers/any.js";
import type { JsonSchema7ArrayType } from "./parsers/array.js";
import type { JsonSchema7BigintType } from "./parsers/bigint.js";
import type { JsonSchema7BooleanType } from "./parsers/boolean.js";
import type { JsonSchema7DateType } from "./parsers/date.js";
import type { JsonSchema7EnumType } from "./parsers/enum.js";
import type { JsonSchema7AllOfType } from "./parsers/intersection.js";
import type { JsonSchema7LiteralType } from "./parsers/literal.js";
import type { JsonSchema7MapType } from "./parsers/map.js";
import type { JsonSchema7NativeEnumType } from "./parsers/nativeEnum.js";
import type { JsonSchema7NeverType } from "./parsers/never.js";
import type { JsonSchema7NullType } from "./parsers/null.js";
import type { JsonSchema7NullableType } from "./parsers/nullable.js";
import type { JsonSchema7NumberType } from "./parsers/number.js";
import type { JsonSchema7ObjectType } from "./parsers/object.js";
import type { JsonSchema7RecordType } from "./parsers/record.js";
import type { JsonSchema7SetType } from "./parsers/set.js";
import type { JsonSchema7StringType } from "./parsers/string.js";
import type { JsonSchema7TupleType } from "./parsers/tuple.js";
import type { JsonSchema7UndefinedType } from "./parsers/undefined.js";
import type { JsonSchema7UnionType } from "./parsers/union.js";
import type { JsonSchema7UnknownType } from "./parsers/unknown.js";

type JsonSchema7RefType = { $ref: string };
type JsonSchema7Meta = {
  title?: string;
  default?: any;
  description?: string;
  markdownDescription?: string;
};

export type JsonSchema7TypeUnion =
  | JsonSchema7StringType
  | JsonSchema7ArrayType
  | JsonSchema7NumberType
  | JsonSchema7BigintType
  | JsonSchema7BooleanType
  | JsonSchema7DateType
  | JsonSchema7EnumType
  | JsonSchema7LiteralType
  | JsonSchema7NativeEnumType
  | JsonSchema7NullType
  | JsonSchema7NumberType
  | JsonSchema7ObjectType
  | JsonSchema7RecordType
  | JsonSchema7TupleType
  | JsonSchema7UnionType
  | JsonSchema7UndefinedType
  | JsonSchema7RefType
  | JsonSchema7NeverType
  | JsonSchema7MapType
  | JsonSchema7AnyType
  | JsonSchema7NullableType
  | JsonSchema7AllOfType
  | JsonSchema7UnknownType
  | JsonSchema7SetType;

export type JsonSchema7Type = JsonSchema7TypeUnion & JsonSchema7Meta;
