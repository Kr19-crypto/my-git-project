import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(here, '..', 'package.json')
const changelogPath = join(here, '..', '..', 'CHANGELOG.md')

const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const changelog = await readFile(changelogPath, 'utf8')

const version = pkg.version
const match = changelog.match(/^## \[([^\]]+)\]/m)
if (!match) {
  throw new Error('CHANGELOG.md does not contain a version heading')
}

if (match[1] !== version) {
  throw new Error(
    `Version mismatch: package.json=${version}, CHANGELOG.md=${match[1]}`,
  )
}

console.log(`Version OK: ${version}`)
