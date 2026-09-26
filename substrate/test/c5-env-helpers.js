// Temporarily sets process.env vars for the duration of an async function, then restores whatever was
// there before (deleting keys that didn't previously exist). substrate/test/helpers.js's cli() spreads
// process.env into the child process env, so setting vars here is how these tests select the notify.js
// driver and point it at a local server without touching the shared cli() helper.
export async function withEnv(vars, fn) {
  const prev = {}
  for (const k of Object.keys(vars)) prev[k] = process.env[k]
  Object.assign(process.env, vars)
  try {
    return await fn()
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}
