#!/usr/bin/env python3
"""Edit ui/src/main.tsx to add Sentry init."""

path = "/Users/benh/Programming/paperclip/ui/src/main.tsx"
with open(path, "r") as f:
    content = f.read()

# Add import for initSentry and call it
content = content.replace(
    'import { startPerfMeasureReaper } from "./lib/perf-measure-reaper";\nimport "@mdxeditor/editor/style.css";',
    'import { startPerfMeasureReaper } from "./lib/perf-measure-reaper";\nimport { initSentry } from "./lib/sentry";\nimport "@mdxeditor/editor/style.css";',
    1
)

content = content.replace(
    'initPluginBridge(React, ReactDOM);\n\n// React 19.2',
    'initPluginBridge(React, ReactDOM);\n\n// Initialise Sentry error tracking. No-op when VITE_SENTRY_DSN is unset.\ninitSentry();\n\n// React 19.2',
    1
)

with open(path, "w") as f:
    f.write(content)

print("Done - edits applied to ui/src/main.tsx")