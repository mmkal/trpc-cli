#!/bin/bash
set -euo pipefail

# Vendors typebox (https://github.com/sinclairzx81/typebox) into src/typebox/vendor.
#
# Unlike cp-zod-to-json-schema.sh, this script is for *upgrades only* - it is NOT part of
# `pnpm build`. The vendored + patched source is committed to this repo, because it carries
# local modifications. Those modifications live in src/typebox/jsdoc-description.patch, which
# this script applies as its final step. To upgrade typebox: bump the version in package.json
# devDependencies, run this script, fix up the patch if it no longer applies, commit.
#
# ALSO on upgrade: if the new version adds any NEW concrete schema interfaces (look for new files
# in src/typebox/vendor/type/types/), each one needs a matching `declare module` entry in
# src/typebox/standard.ts. Runtime `~standard` comes for free (the export-surface wrapper covers
# every builder), but without the declare-module entry, schemas of the new kind silently won't
# have `~standard` at the *type* level.

# Find the version from package.json (devDependencies or dependencies)
VERSION=$(jq -r '.devDependencies["typebox"] // .dependencies["typebox"]' package.json)
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  echo "Could not find typebox version in package.json" >&2
  exit 1
fi

echo "typebox version: $VERSION"

# Remove temp dir if it exists
rm -rf /tmp/typebox-temp

# Clone the repo at the version tag (typebox tags releases as plain versions, e.g. `1.2.8`)
if ! git clone --depth 1 --branch "$VERSION" https://github.com/sinclairzx81/typebox.git /tmp/typebox-temp; then
  echo "Failed to clone typebox repo at tag $VERSION" >&2
  exit 1
fi

COMMIT=$(git -C /tmp/typebox-temp rev-parse HEAD)
echo "typebox commit: $COMMIT"

# Copy src directory
rm -rf src/typebox/vendor
mkdir -p src/typebox
if ! cp -r /tmp/typebox-temp/src src/typebox/vendor; then
  echo "Failed to copy src directory" >&2
  exit 1
fi

# Clean up
echo "Cleaning up temp directory"
rm -rf /tmp/typebox-temp

# Rewrite deno-style `./foo.ts` relative import specifiers to `./foo.js` so the existing
# NodeNext tsc build compiles the source untouched (no rewriteRelativeImportExtensions).
find src/typebox/vendor -type f -name '*.ts' -exec perl -pi -e \
  's/(from\s+(['\''"]))(\.[^'\''"]+)\.ts(\2)/$1$3.js$4/g' {} +

# Apply local modifications (jsdoc -> description parsing in Type.Script). Each modified file
# carries an attribution header summarizing the change - see the patch file itself for details.
git apply --whitespace=nowarn src/typebox/jsdoc-description.patch

echo "Done! src/typebox/vendor is now at typebox@$VERSION ($COMMIT) + src/typebox/jsdoc-description.patch"
