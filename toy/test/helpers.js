import { createApp } from '../src/app.js'

// Starts a fresh app on an ephemeral port; returns { base, close }.
export async function start() {
  const app = createApp()
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => new Promise(r => server.close(r)) }
}
