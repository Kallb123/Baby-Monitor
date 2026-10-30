// Bumps the version shown in the settings page footer: npm run bump <patch|minor|major>
import { execFileSync } from 'node:child_process'

const LEVELS = ['patch', 'minor', 'major']
const level = process.argv[2]

if (!level || !LEVELS.includes(level)) {
  console.error(`Usage: npm run bump <${LEVELS.join('|')}>`)
  process.exit(1)
}

// No git commit or tag: the bump ships in the same PR as the change it versions.
execFileSync('npm', ['version', level, '--no-git-tag-version'], { stdio: 'inherit' })
