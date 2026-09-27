// The suite must never deliver a real notification. substrate/notify.js reads NOTIFY_* from the environment, and a
// session whose environment carries a live NOTIFY_GITHUB_TOKEN would otherwise open a real GitHub issue for every
// gate a test opens: on 2026-09-27 it did, 72 times (issues #12–#83 on the configured repo), from local runs and a
// build's Test Runner. So the suite starts from NO delivery config: `npm test` preloads this file, and helpers.js /
// c5-env-helpers.js import it too, so a test file run on its own is covered. A test that exercises delivery sets
// its own NOTIFY_* (withEnv) and points NOTIFY_GITHUB_API at a local server. Child processes inherit the cleaned env.
for (const k of Object.keys(process.env)) if (k.startsWith('NOTIFY_')) delete process.env[k]
