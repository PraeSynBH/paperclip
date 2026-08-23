#!/usr/bin/env python3
"""Edit package.json files to add @sentry dependencies."""

# Server package.json
path = "/Users/benh/Programming/paperclip/server/package.json"
with open(path, "r") as f:
    content = f.read()

content = content.replace(
    '"@paperclipai/hermes-paperclip-adapter": "workspace:*",\n    "ajv"',
    '"@paperclipai/hermes-paperclip-adapter": "workspace:*",\n    "@sentry/node": "^8.55.1",\n    "ajv"',
    1
)

with open(path, "w") as f:
    f.write(content)

# UI package.json
path = "/Users/benh/Programming/paperclip/ui/package.json"
with open(path, "r") as f:
    content = f.read()

content = content.replace(
    '"@radix-ui/react-slot": "^1.3.0",\n    "@tailwindcss/typography"',
    '"@radix-ui/react-slot": "^1.3.0",\n    "@sentry/react": "^8.55.1",\n    "@tailwindcss/typography"',
    1
)

with open(path, "w") as f:
    f.write(content)

print("Done - edits applied to package.json files")