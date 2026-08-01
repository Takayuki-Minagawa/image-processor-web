import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const baselinePath = path.join(root, 'scripts', 'i18n-hardcoded-baseline.json')
const japanesePattern = /[\u3040-\u30ff\u3400-\u9fff]/u

const normalize = (value) => value.replace(/\s+/gu, ' ').trim()

const collectTsxFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectTsxFiles(absolute)))
    else if (
      entry.isFile() &&
      entry.name.endsWith('.tsx') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(absolute)
    }
  }
  return files
}

const literalText = (node) => {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isJsxText(node)
  ) {
    return node.text
  }
  if (
    node.kind === ts.SyntaxKind.TemplateHead ||
    node.kind === ts.SyntaxKind.TemplateMiddle ||
    node.kind === ts.SyntaxKind.TemplateTail
  ) {
    return node.text
  }
  return null
}

const inspectFile = async (absolutePath) => {
  const source = await readFile(absolutePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const findings = []
  const visit = (node) => {
    const text = literalText(node)
    const normalized = text === null ? '' : normalize(text)
    if (normalized && japanesePattern.test(normalized)) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart())
      findings.push({ line: start.line + 1, text: normalized })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return findings
}

const digestFindings = (findings) =>
  createHash('sha256')
    .update(
      findings
        .map(({ text }) => text)
        .sort((left, right) => left.localeCompare(right, 'ja'))
        .join('\0'),
    )
    .digest('hex')

const buildSnapshot = async () => {
  const snapshot = {}
  for (const absolutePath of (await collectTsxFiles(sourceRoot)).sort()) {
    const findings = await inspectFile(absolutePath)
    if (findings.length === 0) continue
    const relativePath = path.relative(root, absolutePath)
    snapshot[relativePath] = {
      count: findings.length,
      sha256: digestFindings(findings),
    }
  }
  return snapshot
}

const snapshot = await buildSnapshot()
if (process.argv.includes('--print-baseline')) {
  process.stdout.write(
    `${JSON.stringify({ version: 1, files: snapshot }, null, 2)}\n`,
  )
  process.exit(0)
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
if (baseline.version !== 1 || typeof baseline.files !== 'object') {
  throw new Error('The i18n hardcoded-string baseline is invalid.')
}

const paths = new Set([
  ...Object.keys(baseline.files),
  ...Object.keys(snapshot),
])
const changed = [...paths].sort().filter((file) => {
  const expected = baseline.files[file]
  const actual = snapshot[file]
  return (
    expected?.count !== actual?.count || expected?.sha256 !== actual?.sha256
  )
})

if (changed.length > 0) {
  const details = []
  for (const file of changed) {
    const absolutePath = path.join(root, file)
    let findings = []
    try {
      findings = await inspectFile(absolutePath)
    } catch {
      // A removed file is still useful baseline drift and needs no line detail.
    }
    details.push(
      `${file}: expected ${baseline.files[file]?.count ?? 0}, found ${findings.length}`,
      ...findings.map(({ line, text }) => `  ${line}: ${text}`),
    )
  }
  process.stderr.write(
    [
      'Hardcoded Japanese TSX strings changed.',
      'Move new UI copy into a namespaced catalog. If existing debt was intentionally migrated, review and refresh the baseline.',
      ...details,
      '',
    ].join('\n'),
  )
  process.exit(1)
}

process.stdout.write(
  'Hardcoded Japanese TSX strings match the reviewed baseline.\n',
)
