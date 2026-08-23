#!/usr/bin/env python3
"""Edit package.json files to add @sentry dependencies."""

# Server package.json
path = "/Users/benh/Programming/paperclip/server/package.json"
with open(path, "r") as f:
    lines = f.readlines()

# Find the line with @paperclipai/hermes-paperclip-adapter and add @sentry/node after it
new_lines = []
for line in lines:
    new_lines.append(line)
    if '"@paperclipai/hermes-paperclip-adapter": "workspace:*",' in line:
        new_lines.append('    "@sentry/node": "^8.55.1",\n')

with open(path, "w") as f:
    f.writelines(new_lines)

print(f"Edited {path}")

# UI package.json
path = "/Users/benh/Programming/paperclip/ui/package.json"
with open(path, "r") as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    new_lines.append(line)
    if '"@radix-ui/react-slot": "^1.3.0",' in line:
        new_lines.append('    "@sentry/react": "^8.55.1",\n')

with open(path, "w") as f:
    f.writelines(new_lines)

print(f"Edited {path}")
print("Done")