import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(new URL('../.github/workflows/smart-pr-release.yml', import.meta.url), 'utf8')
const ciWorkflow = await readFile(new URL('../.github/workflows/ci-reusable.yml', import.meta.url), 'utf8')
const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const corePackage = JSON.parse(await readFile(new URL('../packages/core/package.json', import.meta.url), 'utf8'))
const cliPackage = JSON.parse(await readFile(new URL('../packages/cli/package.json', import.meta.url), 'utf8'))

function getJob(name) {
  const marker = `  ${name}:\n`
  const start = workflow.indexOf(marker)
  assert.notEqual(start, -1, `workflow job not found: ${name}`)

  const remainder = workflow.slice(start + marker.length)
  const nextJob = /^ {2}[a-zA-Z0-9_-]+:\s*$/m.exec(remainder)
  return workflow.slice(start, nextJob?.index === undefined ? undefined : start + marker.length + nextJob.index)
}

function getStep(jobName, stepName) {
  const job = getJob(jobName)
  const marker = `      - name: ${stepName}`
  const start = job.indexOf(marker)
  assert.notEqual(start, -1, `workflow step not found in ${jobName}: ${stepName}`)

  const next = job.indexOf('\n      - name:', start + marker.length)
  return job.slice(start, next === -1 ? undefined : next)
}

function getCiJob(name) {
  const marker = `  ${name}:\n`
  const start = ciWorkflow.indexOf(marker)
  assert.notEqual(start, -1, `CI workflow job not found: ${name}`)

  const remainder = ciWorkflow.slice(start + marker.length)
  const nextJob = /^ {2}[a-zA-Z0-9_-]+:\s*$/m.exec(remainder)
  return ciWorkflow.slice(start, nextJob?.index === undefined ? undefined : start + marker.length + nextJob.index)
}

function getCiStep(jobName, stepName) {
  const job = getCiJob(jobName)
  const marker = `      - name: ${stepName}`
  const start = job.indexOf(marker)
  assert.notEqual(start, -1, `CI workflow step not found in ${jobName}: ${stepName}`)

  const next = job.indexOf('\n      - name:', start + marker.length)
  return job.slice(start, next === -1 ? undefined : next)
}

for (const jobName of ['render', 'create']) {
  test(`${jobName} uses the caller-selected runner`, () => {
    const job = getJob(jobName)

    assert.match(job, /^\s+runs-on: \$\{\{ inputs\.runs_on \}\}\s*$/m)
  })

  test(`${jobName} checks out the reusable workflow repository at the invoked commit`, () => {
    const step = getStep(jobName, 'Checkout smart-pr-release')

    assert.match(step, /^\s+repository: \$\{\{ job\.workflow_repository \}\}\s*$/m)
    assert.match(step, /^\s+ref: \$\{\{ job\.workflow_sha \}\}\s*$/m)
    assert.match(step, /^\s+path: \.smart-pr-release-action\s*$/m)
    assert.match(step, /^\s+persist-credentials: false\s*$/m)
  })

  test(`${jobName} loads Node and pnpm configuration only from the self checkout`, () => {
    const pnpmStep = getStep(jobName, 'Setup pnpm')
    const nodeStep = getStep(jobName, 'Setup Node.js')

    assert.match(pnpmStep, /pnpm\/action-setup@0ebf47130e4866e96fce0953f49152a61190b271/)
    assert.match(pnpmStep, /^\s+package_json_file: \.smart-pr-release-action\/package\.json\s*$/m)
    assert.match(pnpmStep, /^\s+cache_dependency_path: \.smart-pr-release-action\/pnpm-lock\.yaml\s*$/m)
    assert.match(nodeStep, /^\s+node-version-file: \.smart-pr-release-action\/\.node-version\s*$/m)
    assert.match(nodeStep, /^\s+cache-dependency-path: \.smart-pr-release-action\/pnpm-lock\.yaml\s*$/m)
    assert.doesNotMatch(pnpmStep, /^\s+package_json_file: package\.json\s*$/m)
    assert.doesNotMatch(pnpmStep, /^\s+cache_dependency_path: pnpm-lock\.yaml\s*$/m)
  })

  test(`${jobName} verifies the pinned runtime versions without exposing environment data`, () => {
    const step = getStep(jobName, 'Verify toolchain versions')

    assert.match(step, /test "\$\(node --version\)" = "v24\.18\.0"/)
    assert.match(step, /test "\$\(pnpm --version\)" = "11\.13\.1"/)
  })
}

test('defaults the reusable workflow runner to ubuntu-latest', () => {
  assert.match(
    workflow,
    /^\s+runs_on:\n\s+description: 'Runner label used by the render and create jobs'\n\s+type: string\n\s+default: 'ubuntu-latest'\s*$/m,
  )
})

test('keeps caller-controlled rendering in a read-only job', () => {
  const renderJob = getJob('render')

  assert.match(renderJob, /^\s+pull-requests: read(?:\s+#.*)?\s*$/m)
  assert.doesNotMatch(renderJob, /^\s+(?:pull-requests|issues|contents): write(?:\s+#.*)?\s*$/m)
  assert.doesNotMatch(renderJob, /Create or Update Release PR/)
})

test('transfers rendered data as an artifact to a fresh write-capable job', () => {
  const renderStep = getStep('render', 'Render Release PR')
  const uploadStep = getStep('render', 'Upload rendered result')
  const createJob = getJob('create')
  const downloadStep = getStep('create', 'Download rendered result')
  const createStep = getStep('create', 'Create or Update Release PR')

  assert.match(
    renderStep,
    /^\s+result_path: \$\{\{ runner\.temp \}\}\/smart-pr-release-render\/render-result\.json\s*$/m,
  )
  assert.match(uploadStep, /actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(createJob, /^\s+needs: render\s*$/m)
  assert.match(createJob, /^\s+pull-requests: write(?:\s+#.*)?\s*$/m)
  assert.match(downloadStep, /actions\/download-artifact@[0-9a-f]{40}/)
  assert.match(
    createStep,
    /^\s+result_path: \$\{\{ runner\.temp \}\}\/smart-pr-release-render\/render-result\.json\s*$/m,
  )
  assert.doesNotMatch(createStep, /steps\.render\.outputs\.(?:title|body)/)
})

test('preserves the reusable workflow output contract through the create job', () => {
  assert.match(workflow, /^\s+value: \$\{\{ jobs\.create\.outputs\.pr_number \}\}\s*$/m)
  assert.match(workflow, /^\s+value: \$\{\{ jobs\.create\.outputs\.pr_url \}\}\s*$/m)
  assert.match(workflow, /^\s+value: \$\{\{ jobs\.create\.outputs\.created \}\}\s*$/m)
})

test('runs actionlint without requiring pull request write permissions', () => {
  const topLevelPermissions = /^permissions:\n(?<entries>(?: {2}.+\n?)*)$/m.exec(ciWorkflow)
  assert.equal(topLevelPermissions?.groups?.entries.trim(), 'contents: read')

  const lintJob = getCiJob('lint-workflows')
  const actionlintStep = getCiStep('lint-workflows', 'Run actionlint')
  assert.match(actionlintStep, /^\s+reporter: local\s*$/m)
  assert.match(actionlintStep, /^\s+filter_mode: nofilter\s*$/m)
  assert.doesNotMatch(actionlintStep, /^\s+reporter: github-pr-review\s*$/m)
  assert.doesNotMatch(lintJob, /^\s+permissions:/m)
})

test('tests the published Node.js minimum consistently', () => {
  const minimumNodeVersion = '22.22.1'
  const compatibilityJob = getCiJob('node-minimum-compatibility')
  const setupNodeStep = getCiStep('node-minimum-compatibility', 'Setup Node.js')

  assert.equal(rootPackage.engines.node, `>=${minimumNodeVersion}`)
  assert.equal(corePackage.engines.node, `>=${minimumNodeVersion}`)
  assert.equal(cliPackage.engines.node, `>=${minimumNodeVersion}`)
  assert.match(compatibilityJob, /^\s+name: Node\.js Minimum Version Compatibility\s*$/m)
  assert.match(setupNodeStep, new RegExp(`^\\s+node-version: '${minimumNodeVersion}'\\s*$`, 'm'))
})
