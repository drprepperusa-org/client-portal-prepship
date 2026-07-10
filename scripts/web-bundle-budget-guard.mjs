import { readdir, readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const root = process.cwd()
// build:web builds the active portal-client app, so budget its output —
// web/dist is the retired legacy build and only exists as a stale artifact.
const assetsDir = path.join(root, 'portal-client/dist/assets')
const packageJsonPath = path.join(root, 'package.json')
const CSS_RAW_LIMIT = 75 * 1024
const CSS_GZIP_LIMIT = 15 * 1024
const LARGEST_JS_RAW_LIMIT = 735 * 1024
const LARGEST_JS_GZIP_LIMIT = 215 * 1024
const TOTAL_JS_RAW_LIMIT = Math.floor(1.9 * 1024 * 1024)
const TOTAL_JS_GZIP_LIMIT = 535 * 1024
const GRADIENT_RULE_LIMIT = 300

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exitCode = 1
}

function pass(message) {
  console.log(`PASS ${message}`)
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString('en-US')} bytes`
}

async function findIndexCssAsset() {
  let entries
  try {
    entries = await readdir(assetsDir)
  } catch (error) {
    throw new Error(`Unable to read ${assetsDir}. Run the web build before this guard. ${error.message}`)
  }

  const candidates = entries
    .filter((entry) => /^index-.*\.css$/.test(entry))
    .map((entry) => path.join(assetsDir, entry))

  if (candidates.length === 0) {
    throw new Error(`No index-*.css asset found in ${assetsDir}. Run the web build before this guard.`)
  }

  const stats = await Promise.all(candidates.map(async (filePath) => ({ filePath, stats: await stat(filePath) })))
  stats.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs)
  return stats[0].filePath
}

function countGradientUtilityRules(css) {
  const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  return rules.filter((rule) => /(^|[,\s])\.(?:[-_a-zA-Z0-9]+\\:)*(?:from|via|to)-/.test(rule)).length
}

const cssPath = await findIndexCssAsset()
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const css = await readFile(cssPath)
const rawSize = css.byteLength
const gzipSize = gzipSync(css).byteLength
const cssText = css.toString('utf8')
const gradientRuleCount = countGradientUtilityRules(cssText)
const assetEntries = await readdir(assetsDir)
const jsAssets = await Promise.all(
  assetEntries
    .filter((entry) => entry.endsWith('.js'))
    .map(async (entry) => {
      const contents = await readFile(path.join(assetsDir, entry))
      return {
        entry,
        rawSize: contents.byteLength,
        gzipSize: gzipSync(contents).byteLength,
      }
    }),
)
jsAssets.sort((left, right) => right.rawSize - left.rawSize)
const largestJs = jsAssets[0]
const totalJsRawSize = jsAssets.reduce((total, asset) => total + asset.rawSize, 0)
const totalJsGzipSize = jsAssets.reduce((total, asset) => total + asset.gzipSize, 0)

console.log(`CSS asset: ${path.relative(root, cssPath)}`)
console.log(`Raw size: ${formatBytes(rawSize)}`)
console.log(`Gzip size: ${formatBytes(gzipSize)}`)
console.log(`Generated gradient from/via/to rules: ${gradientRuleCount.toLocaleString('en-US')}`)
if (!largestJs) {
  fail(`at least one JavaScript asset must exist in ${assetsDir}`)
} else {
  console.log(`Largest JS asset: ${largestJs.entry}`)
  console.log(`Largest JS raw size: ${formatBytes(largestJs.rawSize)}`)
  console.log(`Largest JS gzip size: ${formatBytes(largestJs.gzipSize)}`)
  console.log(`Total JS raw size: ${formatBytes(totalJsRawSize)}`)
  console.log(`Total JS gzip size: ${formatBytes(totalJsGzipSize)}`)
}

if (rawSize > CSS_RAW_LIMIT) {
  fail(`global CSS raw size must be <= ${formatBytes(CSS_RAW_LIMIT)}`)
} else {
  pass(`global CSS raw size is within ${formatBytes(CSS_RAW_LIMIT)}`)
}

if (gzipSize > CSS_GZIP_LIMIT) {
  fail(`global CSS gzip size must be <= ${formatBytes(CSS_GZIP_LIMIT)}`)
} else {
  pass(`global CSS gzip size is within ${formatBytes(CSS_GZIP_LIMIT)}`)
}

if (largestJs?.rawSize > LARGEST_JS_RAW_LIMIT) {
  fail(`largest JS raw size must be <= ${formatBytes(LARGEST_JS_RAW_LIMIT)}`)
} else if (largestJs) {
  pass(`largest JS raw size is within ${formatBytes(LARGEST_JS_RAW_LIMIT)}`)
}

if (largestJs?.gzipSize > LARGEST_JS_GZIP_LIMIT) {
  fail(`largest JS gzip size must be <= ${formatBytes(LARGEST_JS_GZIP_LIMIT)}`)
} else if (largestJs) {
  pass(`largest JS gzip size is within ${formatBytes(LARGEST_JS_GZIP_LIMIT)}`)
}

if (totalJsRawSize > TOTAL_JS_RAW_LIMIT) {
  fail(`total JS raw size must be <= ${formatBytes(TOTAL_JS_RAW_LIMIT)}`)
} else {
  pass(`total JS raw size is within ${formatBytes(TOTAL_JS_RAW_LIMIT)}`)
}

if (totalJsGzipSize > TOTAL_JS_GZIP_LIMIT) {
  fail(`total JS gzip size must be <= ${formatBytes(TOTAL_JS_GZIP_LIMIT)}`)
} else {
  pass(`total JS gzip size is within ${formatBytes(TOTAL_JS_GZIP_LIMIT)}`)
}

if (gradientRuleCount > GRADIENT_RULE_LIMIT) {
  fail(`generated gradient from/via/to rules must be <= ${GRADIENT_RULE_LIMIT}`)
} else {
  pass(`generated gradient from/via/to rules are within ${GRADIENT_RULE_LIMIT}`)
}

if (packageJson.scripts?.['test:web-bundle-budget'] !== 'npm run build:web && node scripts/web-bundle-budget-guard.mjs') {
  fail('package.json must expose test:web-bundle-budget')
} else {
  pass('package.json exposes test:web-bundle-budget')
}

if (process.exitCode) {
  process.exit(process.exitCode)
}
