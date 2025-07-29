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

echo "Done! src/zod-to-json-schema is now at zod-to-json-schema@$VERSION ($GIT_HEAD)" 