#!/usr/bin/env python3
"""Edit server/src/app.ts to add Sentry middleware imports and usage."""

path = "/Users/benh/Programming/paperclip/server/src/app.ts"
with open(path, "r") as f:
    content = f.read()

# 1. Add import for sentry middleware
content = content.replace(
    'import { httpLogger, errorHandler } from "./middleware/index.js";\nimport { actorMiddleware }',
    'import { httpLogger, errorHandler } from "./middleware/index.js";\nimport { sentryRequestHandler, sentryTracingHandler, sentryErrorHandler } from "./middleware/sentry.js";\nimport { actorMiddleware }',
    1
)

# 2. Add sentryRequestHandler and sentryTracingHandler after applyTrustProxy
content = content.replace(
    'applyTrustProxy(app, parseTrustProxyEnv(process.env.TRUST_PROXY));\n\n  app.use(COMPANY_IMPORT_API_PATH',
    'applyTrustProxy(app, parseTrustProxyEnv(process.env.TRUST_PROXY));\n\n  // Sentry request handler — captures request metadata for error tracking.\n  app.use(sentryRequestHandler);\n  app.use(sentryTracingHandler);\n\n  app.use(COMPANY_IMPORT_API_PATH',
    1
)

# 3. Add sentryErrorHandler before errorHandler
content = content.replace(
    'app.use(errorHandler);\n\n  jobCoordinator.start();',
    'app.use(sentryErrorHandler);\n  app.use(errorHandler);\n\n  jobCoordinator.start();',
    1
)

with open(path, "w") as f:
    f.write(content)

print("Done - edits applied to server/src/app.ts")