// Bundles each extension in src/ into a single self-contained ES module under sources/,
// since Shiru loads extension code from a blob URL where relative imports can't resolve.
import { readdirSync } from 'node:fs'

const entrypoints = readdirSync('src').filter(file => file.endsWith('.js')).map(file => `src/${file}`)
const result = await Bun.build({ entrypoints, outdir: 'sources', format: 'esm', target: 'browser', minify: false })
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const output of result.outputs) console.log(`built ${output.path}`)
