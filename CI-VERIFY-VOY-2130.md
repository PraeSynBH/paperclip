# CI verification — VOY-2130

This PR verifies that the @voyonder workspace dependency removal fix (VOY-2128)
resolves the CI dependency resolution failure. The only change is this doc.

- Lockfile staleness on master was fixed in a separate push
- No @voyonder references remain in server/package.json
- Dynamic import with try/catch in server/src/app.ts handles absence gracefully
