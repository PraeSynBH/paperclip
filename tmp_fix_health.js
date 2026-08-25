const fs = require("fs");
const path = "/app/dist/server/src/index.js";
let src = fs.readFileSync(path, "utf8");

// Replace the health endpoint ordering - move it before app.use(voyonderRouter)
const before = "const app = express();\n    app.use(voyonderRouter);\n    // Add a health check endpoint (not included in createVoyonderApp because\n    // Paperclip's metrics middleware handles health when mounted in-process)\n    app.get(\"/api/health\", (_req, res) => {\n        res.json({ status: \"ok\", timestamp: new Date().toISOString() });\n    });";

const after = "const app = express();\n\n    // Health check MUST be mounted BEFORE createVoyonderApp() because it returns\n    // a full Express app (not a Router) with its own 404 handler that shadows\n    // outer routes.\n    app.get(\"/api/health\", (_req, res) => {\n        res.json({ status: \"ok\", timestamp: new Date().toISOString() });\n    });\n    app.use(voyonderRouter);";

if (src.includes(before)) {
  src = src.replace(before, after);
  fs.writeFileSync(path, src, "utf8");
  console.log("SUCCESS: Fixed health endpoint ordering");
} else {
  console.log("FAIL: Pattern not found in index.js");
  // Debug: show the actual content around the match area
  const idx = src.indexOf("const app = express");
  if (idx >= 0) {
    console.log("Found target at offset", idx);
    console.log("--- Actual content ---");
    console.log(JSON.stringify(src.slice(idx, idx + 350)));
    console.log("--- Expected pattern ---");
    console.log(JSON.stringify(before));
  }
}
