#!/usr/bin/env python3
"""Edit server/src/index.ts to add Sentry import, init, and close."""

import re

path = "/Users/benh/Programming/paperclip/server/src/index.ts"
with open(path, "r") as f:
    content = f.read()

# 1. Add import after the last route import (line with InstanceDatabaseBackupTrigger)
content = content.replace(
    '} from "./routes/instance-database-backups.js";\n\n',
    '} from "./routes/instance-database-backups.js";\nimport { initSentry, closeSentry } from "./services/sentry.js";\n\n',
    1
)

# 2. Add initSentry after initTelemetry
content = content.replace(
    'initTelemetry({ enabled: config.telemetryEnabled });\n  if (process.env',
    'initTelemetry({ enabled: config.telemetryEnabled });\n  void initSentry();\n  if (process.env',
    1
)

# 3. Add closeSentry after finalizeServerShutdown
content = content.replace(
    '});\n\n      process.exit(0);',
    '});\n\n      await closeSentry();\n\n      process.exit(0);',
    1
)

with open(path, "w") as f:
    f.write(content)

print("Done")