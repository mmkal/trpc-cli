#!/bin/bash
set -euo pipefail

# Find the version from package.json (devDependencies or dependencies)
VERSION=$(jq -r '.devDependencies["zod-to-json-schema"] // .dependencies["zod-to-json-schema"]' package.json)
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "Could not find zod-to-json-schema version in package.json" >&2
  exit 1
fi

echo "zod-to-json-schema version: $VERSION"

# Get the git commit hash for that version from npm
GIT_HEAD=$(npm view zod-to-json-schema@"$VERSION" gitHead)
if [[ -z "$GIT_HEAD" ]]; then
  echo "Could not find git commit hash for zod-to-json-schema@$VERSION from npm" >&2
  exit 1
fi

echo "Git commit hash: $GIT_HEAD"

# Remove temp dir if it exists
rm -rf /tmp/zod-to-json-schema-temp

# Clone the repo
if ! git clone https://github.com/StefanTerdell/zod-to-json-schema.git /tmp/zod-to-json-schema-temp; then
  echo "Failed to clone zod-to-json-schema repo" >&2
  exit 1
fi

cd /tmp/zod-to-json-schema-temp

# Checkout the correct commit
if ! git checkout "$GIT_HEAD"; then
  echo "Failed to checkout commit $GIT_HEAD" >&2
  exit 1
fi

cd - > /dev/null

# Copy src directory
rm -rf src/zod-to-json-schema
if ! cp -r /tmp/zod-to-json-schema-temp/src src/zod-to-json-schema; then
  echo "Failed to copy src directory" >&2
  exit 1
fi

# Clean up
echo "Cleaning up temp directory"
rm -rf /tmp/zod-to-json-schema-temp

find src/zod-to-json-schema -type f -name '*.ts' -exec node -e '
import * as fs from "fs";
import * as path from "path";

let content = fs.readFileSync("{}", "utf8");

content = content
  .split(";")
  .map(s => {
    if (!s.trim().startsWith("import {")) return s;
    const imports = s.split("{")[1].split("}")[0].trim()
      .split(",")
      .map(i => i.trim())
      .filter(i => i !== "ZodFirstPartyTypeKind")
      .filter(Boolean);

    if (imports.length === 0) {
      return "";
    }

    if (imports.every(i => i[0] === i[0].toUpperCase())) {
      return `import type { ${imports.join(", ")} }${s.split("}")[1]}`;
    }
    const typeified = imports.map(i => i.match(/^[A-Z]/) ? `type ${i}` : i);
    return `import { ${typeified.join(", ")} }${s.split("}")[1]}`;
  })
  .filter(Boolean)
  .join(";");

content = content.replaceAll(";import", ";\nimport");


if (content.includes("ZodFirstPartyTypeKind")) {
  let relPath = path.relative(path.dirname("{}"), path.join(process.cwd(), "src/zod-to-json-schema/ZodFirstPartyTypeKind.js"));
  if (!relPath.startsWith(".")) relPath = "./" + relPath;
  content = [
    `import {ZodFirstPartyTypeKind} from ${JSON.stringify(relPath)};`,
    content,
  ].join("\n");
}

fs.writeFileSync("{}", content);
' {} ';'

echo '/** copy-pasted from zod v3, to minimize diff vs zod-to-json-schema */
export enum ZodFirstPartyTypeKind {
  ZodString = "ZodString",
  ZodNumber = "ZodNumber",
  ZodNaN = "ZodNaN",
  ZodBigInt = "ZodBigInt",
  ZodBoolean = "ZodBoolean",
  ZodDate = "ZodDate",
  ZodSymbol = "ZodSymbol",
  ZodUndefined = "ZodUndefined",
  ZodNull = "ZodNull",
  ZodAny = "ZodAny",
  ZodUnknown = "ZodUnknown",
  ZodNever = "ZodNever",
  ZodVoid = "ZodVoid",
  ZodArray = "ZodArray",
  ZodObject = "ZodObject",
  ZodUnion = "ZodUnion",
  ZodDiscriminatedUnion = "ZodDiscriminatedUnion",
  ZodIntersection = "ZodIntersection",
  ZodTuple = "ZodTuple",
  ZodRecord = "ZodRecord",
  ZodMap = "ZodMap",
  ZodSet = "ZodSet",
  ZodFunction = "ZodFunction",
  ZodLazy = "ZodLazy",
  ZodLiteral = "ZodLiteral",
  ZodEnum = "ZodEnum",
  ZodEffects = "ZodEffects",
  ZodNativeEnum = "ZodNativeEnum",
  ZodOptional = "ZodOptional",
  ZodNullable = "ZodNullable",
  ZodDefault = "ZodDefault",
  ZodCatch = "ZodCatch",
  ZodPromise = "ZodPromise",
  ZodBranded = "ZodBranded",
  ZodPipeline = "ZodPipeline",
  ZodReadonly = "ZodReadonly"
}' > src/zod-to-json-schema/ZodFirstPartyTypeKind.ts

echo "Done! src/zod-to-json-schema is now at zod-to-json-schema@$VERSION ($GIT_HEAD)" 