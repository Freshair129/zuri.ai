import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { admitConfiguredTasks } from '../delivery-control/controller-cli.mjs';
import { parseRoadmapTasks, planRoadmapIntake, runRoadmapIntake } from '../delivery-control/roadmap-intake.mjs';

const AC = 'Given a configured task, when intake runs, then it creates one scoped candidate.';
const AC2 = 'Given the candidate, when preflight completes, then it is ready without executing checks.';
const git = (cwd, args) => execFileSync('git', args, { cwd, shell: false, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','pipe'] }).trimEnd();
function directorySnapshot(root) {
  const entries = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).replaceAll(path.sep, '/');
      const stat = lstatSync(file);
      if (stat.isDirectory()) {
        entries.push([relative, 'directory', stat.mode]);
        visit(file);
      } else if (stat.isFile()) {
        entries.push([relative, 'file', stat.mode, stat.size, createHash('sha256').update(readFileSync(file)).digest('hex')]);
      } else {
        entries.push([relative, 'other', stat.mode]);
      }
    }
  }
  visit(root);
  return JSON.stringify(entries);
}

function makeTask(id, { status = 'planned', priority = 'P1', dependencies = [], evidence = '—', criteria = [AC, AC2], proofScope = 'UNKNOWN' } = {}) {
  return { id, status, priority, dependencies, evidence, criteria, proofScope, title: 'Bounded task ' + id };
}
function tableRow(cells) { return '| ' + cells.join(' | ') + ' |'; }
function docsFor(tasks) {
  const roadmap = [
    '# Canonical task ledger', '', '<!-- roadmap-task-ledger:start -->',
    tableRow(['task_id','sprint','task','status','proof_scope','implementation_state','depends_on','authority','evidence']),
    tableRow(Array(9).fill('---')),
  ];
  const program = ['# Programme backlog', '', '## Backlog Items', '',
    tableRow(['ID','Parent ID','Type','Title','Priority','Owner','Status','Dependencies','Source Section']),
    tableRow(Array(9).fill('---'))];
  for (const task of tasks) {
    roadmap.push(tableRow([task.id,'SPR-ZAI-01',task.title,task.status,task.proofScope,'NOT_STARTED',task.dependencies.join('; ') || '—','ROADMAP.md',task.evidence]));
    program.push(tableRow([task.id,'SPR-ZAI-01','task',task.title,task.priority,'Codex',task.status,task.dependencies.join('; ') || '—','source']));
  }
  roadmap.push('<!-- roadmap-task-ledger:end -->');
  for (const task of tasks) program.push('', '### TC-' + task.id, '', '```yaml',
    'task_container_id: TC-' + task.id,
    'task_id: ' + task.id,
    'title: ' + task.title,
    'definition_of_done:',
    '  acceptance_criteria:',
    ...task.criteria.map((criterion) => '    - criterion: ' + criterion),
    '```');
  return { roadmap: roadmap.join('\n') + '\n', programme: program.join('\n') + '\n' };
}
function campaignFor(repo, base, taskIds, tasks) {
  return {
    schemaVersion: 'roadmap-intake-campaign/v1',
    campaignId: 'test-roadmap-campaign',
    repositoryRoot: repo,
    baseRef: base,
    objective: 'Advance the explicitly scoped roadmap tasks.',
    sourceRef: 'trusted-user-task:autonomous-roadmap-continuation',
    authorizedEffects: ['local scoped implementation and checks'],
    prohibitions: ['no production or provider effects', 'no grants or credential changes'],
    allowedTaskIds: taskIds,
    taskPlans: Object.fromEntries(taskIds.map((id) => {
      const task = tasks.find((item) => item.id === id);
      return [id, { objective: 'Implement ' + task.id + ' from the trusted campaign.', domainOrFeatureKey: 'test/' + id.toLowerCase(), acceptance: task.criteria,
        writeScope: ['src/' + task.id.toLowerCase() + '/'],
        checks: [{ shell: false, executable: 'git', argv: ['--version'], cwd: '.' }],
        mandateReference: 'trusted-user-task:autonomous-roadmap-continuation#' + id }];
    })),
  };
}
function fixture(t, tasks, allowed = tasks.filter((task) => task.status === 'planned').map((task) => task.id)) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'roadmap-intake-'));
  const repo = path.join(tempRoot, 'repo');
  mkdirSync(path.join(repo, 'docs', 'roadmap'), { recursive: true });
  mkdirSync(path.join(repo, 'docs', 'architecture', 'delivery-control', 'contracts'), { recursive: true });
  git(tempRoot, ['init', '--initial-branch=main', repo]);
  git(repo, ['config', 'user.name', 'Roadmap Intake Test']);
  git(repo, ['config', 'user.email', 'roadmap-intake@example.invalid']);
  const docs = docsFor(tasks);
  writeFileSync(path.join(repo, 'docs', 'roadmap', 'ROADMAP.md'), docs.roadmap);
  writeFileSync(path.join(repo, 'docs', 'roadmap', 'ROADMAP-zuri-ai-24w-program.md'), docs.programme);
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
  writeFileSync(path.join(repo, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json'),
    readFileSync(path.join(sourceRoot, 'docs', 'architecture', 'delivery-control', 'contracts', 'model-policy.json')));
  git(repo, ['add', 'docs/roadmap/ROADMAP.md', 'docs/roadmap/ROADMAP-zuri-ai-24w-program.md', 'docs/architecture/delivery-control/contracts/model-policy.json']);
  git(repo, ['commit', '-m', 'fixture roadmap']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const campaignDir = path.join(common, 'zuri-delivery-control', 'campaigns');
  mkdirSync(campaignDir, { recursive: true });
  const campaignFile = path.join(campaignDir, 'campaign.json');
  writeFileSync(campaignFile, JSON.stringify(campaignFor(repo, base, allowed, tasks), null, 2));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  return { tempRoot, repo, base, common, campaignFile, tasks };
}
function assertNoIntakeSideEffects(f, taskId) {
  const branch = 'codex/roadmap-intake/' + taskId.toLowerCase();
  const worktreeRoot = path.join(path.dirname(f.repo), '.worktrees', 'roadmap-intake-v1', taskId.toLowerCase());
  assert.equal(existsSync(worktreeRoot), false);
  assert.equal(git(f.repo, ['branch', '--list', branch]).trim(), '');
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
  assert.equal(existsSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite')), false);
  assert.equal(existsSync(path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1')), false);
}

test('parses the repository canonical Task10 rows and acceptance container', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parsed = parseRoadmapTasks({
    roadmapMarkdown: readFileSync(path.join(root, 'docs/roadmap/ROADMAP.md'), 'utf8'),
    programmeMarkdown: readFileSync(path.join(root, 'docs/roadmap/ROADMAP-zuri-ai-24w-program.md'), 'utf8'),
  });
  assert.deepEqual(parsed.issues, []);
  const task = parsed.tasks.get('TASK-ZAI-010');
  assert.equal(task.status, 'review');
  assert.equal(task.priority, 'P0');
  assert.deepEqual(task.dependencies, ['TASK-ZAI-007']);
  assert.equal(task.criteria.length, 3);
});

test('selects the highest-priority ready allowed task and emits complete task-readiness data', (t) => {
  const done = makeTask('TASK-ZAI-001', { status: 'done', priority: 'P0', evidence: 'PR #1 merged; acceptance evidence recorded.', criteria: [AC] });
  const lower = makeTask('TASK-ZAI-003', { priority: 'P1', dependencies: ['TASK-ZAI-001'] });
  const higher = makeTask('TASK-ZAI-002', { priority: 'P0', dependencies: ['TASK-ZAI-001'] });
  const f = fixture(t, [done, lower, higher]);
  const plan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(plan.status, 'READY_CANDIDATE');
  assert.equal(plan.selectedTaskId, 'TASK-ZAI-002');
  assert.deepEqual(plan.taskRecord.dependencies, [{ taskId: 'TASK-ZAI-001' }]);
  assert.equal(plan.taskRecord.schemaVersion, 'task-readiness/v1');
  assert.equal(plan.dispatchAllowed, false);
  assert.equal(plan.checksExecuted, false);
});

test('creates one exact-base worktree and durable controller binding; repeat returns the same receipt', (t) => {
  const done = makeTask('TASK-ZAI-001', { status: 'done', evidence: 'accepted evidence' });
  const task = makeTask('TASK-ZAI-002', { dependencies: ['TASK-ZAI-001'] });
  const f = fixture(t, [done, task]);
  const first = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(first.status, 'READY');
  assert.equal(first.preflightResult.status, 'READY');
  assert.equal(first.preflightResult.checksExecuted, false);
  assert.equal(first.authorityGrant, false);
  assert.equal(first.dispatchAllowed, false);
  assert.equal(first.controllerBinding.trustedMandateBinding.resolvedBy, 'root');
  assert.equal(first.controllerBinding.trustedMandateBinding.repositoryRoot, f.repo);
  assert.equal(git(first.worktreeRoot, ['rev-parse', 'HEAD']), f.base);
  assert.equal(git(first.worktreeRoot, ['branch', '--show-current']), first.branch);
  assert.equal(git(first.worktreeRoot, ['status', '--porcelain=v1']).trim(), '');
  const second = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(second.status, 'READY');
  assert.equal(second.receiptId, first.receiptId);
  assert.equal(second.worktreeRoot, first.worktreeRoot);
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 2);
});

test('root-private per-task key binds trusted mandate and controller CLI forwards it unchanged', async (t) => {
  const trustedKey = 'domain/private-task-zai-001';
  const task = makeTask('TASK-ZAI-001', { proofScope: 'roadmap/attacker-override' });
  const f = fixture(t, [task]);
  const campaign = JSON.parse(readFileSync(f.campaignFile, 'utf8'));
  campaign.objective = 'Campaign prose refers to prose/campaign-override.';
  campaign.taskPlans[task.id].objective = 'Task objective prose refers to prose/objective-override.';
  campaign.taskPlans[task.id].domainOrFeatureKey = trustedKey;
  writeFileSync(f.campaignFile, JSON.stringify(campaign, null, 2));

  const intake = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(intake.status, 'READY');
  assert.equal(intake.controllerBinding.trustedMandateBinding.domainOrFeatureKey, trustedKey);
  assert.equal(Object.hasOwn(intake.taskRecord, 'domainOrFeatureKey'), false);
  assert.equal(intake.controllerBinding.trustedMandateBinding.objective, campaign.taskPlans[task.id].objective);

  const registered = [];
  const controller = {
    getRun: () => null,
    listRuns: () => [],
    registerTask: async (input) => { registered.push(input); return { taskId: input.taskRecord.taskId, state: 'WORKER_READY' }; },
  };
  const observations = await admitConfiguredTasks({ controller, repoRoot: f.repo,
    config: { tasks: [intake.controllerBinding] }, cache: new Map() });
  assert.equal(observations.length, 1);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].trustedMandateBinding, intake.controllerBinding.trustedMandateBinding);
  assert.equal(registered[0].trustedMandateBinding.domainOrFeatureKey, trustedKey);
});

test('missing root-private task key yields a typed hold before worktree or controller effects', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const campaign = JSON.parse(readFileSync(f.campaignFile, 'utf8'));
  delete campaign.taskPlans[task.id].domainOrFeatureKey;
  writeFileSync(f.campaignFile, JSON.stringify(campaign, null, 2));

  const hold = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(hold.status, 'HOLD_TRUSTED_BINDING');
  assert.equal(hold.code, 'ROOT_DOMAIN_OR_FEATURE_KEY_MISSING');
  assert.equal(hold.dispatchAllowed, false);
  assertNoIntakeSideEffects(f, task.id);
});

test('malformed or non-normalized root-private task keys yield typed pre-side-effect holds', (t) => {
  for (const [key, code] of [
    ['Feature/Task-ZAI-001', 'ROOT_DOMAIN_OR_FEATURE_KEY_NOT_NORMALIZED'],
    ['feature//task-zai-001', 'ROOT_DOMAIN_OR_FEATURE_KEY_INVALID'],
  ]) {
    const task = makeTask('TASK-ZAI-001');
    const f = fixture(t, [task]);
    const campaign = JSON.parse(readFileSync(f.campaignFile, 'utf8'));
    campaign.taskPlans[task.id].domainOrFeatureKey = key;
    writeFileSync(f.campaignFile, JSON.stringify(campaign, null, 2));

    const hold = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
    assert.equal(hold.status, 'HOLD_TRUSTED_BINDING');
    assert.equal(hold.code, code);
    assertNoIntakeSideEffects(f, task.id);
  }
});

test('excludes already-bound tasks and selects the next ready task by priority', (t) => {
  const firstTask = makeTask('TASK-ZAI-001', { priority: 'P0' });
  const secondTask = makeTask('TASK-ZAI-002', { priority: 'P1' });
  const f = fixture(t, [firstTask, secondTask]);
  const first = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(first.status, 'READY');
  assert.equal(first.taskRecord.taskId, firstTask.id);

  const explicitRepeat = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile, taskId: firstTask.id, excludeTaskIds: [firstTask.id] });
  assert.equal(explicitRepeat.receiptId, first.receiptId);

  const nextPlan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile, excludeTaskIds: [firstTask.id] });
  assert.equal(nextPlan.status, 'READY_CANDIDATE');
  assert.equal(nextPlan.selectedTaskId, secondTask.id);
  const second = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile, excludeTaskIds: [firstTask.id] });
  const repeat = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile, excludeTaskIds: [firstTask.id] });
  assert.equal(second.status, 'READY');
  assert.equal(second.taskRecord.taskId, secondTask.id);
  assert.equal(repeat.receiptId, second.receiptId);
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 3);
});

test('a durable higher-priority hold is reported unchanged while an independent ready task is admitted', (t) => {
  const firstTask = makeTask('TASK-ZAI-001', { priority: 'P0' });
  const secondTask = makeTask('TASK-ZAI-002', { priority: 'P1' });
  const f = fixture(t, [firstTask, secondTask]);
  const priorWorktreeRoot = path.join(path.dirname(f.repo), '.worktrees', 'roadmap-intake-v1', firstTask.id.toLowerCase());
  const priorBranch = 'codex/roadmap-intake/' + firstTask.id.toLowerCase();
  const markerFile = path.join(priorWorktreeRoot, 'src', firstTask.id.toLowerCase(), 'prior-worktree-sentinel.txt');
  mkdirSync(path.dirname(priorWorktreeRoot), { recursive: true });
  git(f.repo, ['worktree', 'add', '-b', priorBranch, priorWorktreeRoot, f.base]);
  mkdirSync(path.dirname(markerFile), { recursive: true });
  writeFileSync(markerFile, 'preserve prior HOLD_PREFLIGHT worktree bytes\n');
  const priorWorktreePathBefore = realpathSync.native(priorWorktreeRoot);
  const priorWorktreeHeadBefore = git(priorWorktreeRoot, ['rev-parse', 'HEAD']);
  const priorWorktreeSnapshotBefore = directorySnapshot(priorWorktreeRoot);
  const initialPlan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(initialPlan.selectedTaskId, firstTask.id);

  const inputDigest = createHash('sha256').update(JSON.stringify({
    campaignDigest: initialPlan.campaignDigest,
    sourceDigest: initialPlan.sourceDigest,
    taskId: firstTask.id,
  })).digest('hex');
  const receiptJson = JSON.stringify({
    schemaVersion: 'roadmap-intake-result/v1',
    status: 'HOLD_PREFLIGHT',
    code: 'AUTOMATIC_PREFLIGHT_BLOCKED',
    taskId: firstTask.id,
    receiptId: 'durable-preflight-hold',
    baseCommit: f.base,
    branch: priorBranch,
    worktreeRoot: priorWorktreeRoot,
    worktreeCreated: true,
    authorityGrant: false,
    dispatchAllowed: false,
    checksExecuted: false,
  }, null, 2) + '\n';
  const intakeFile = path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1', 'intake.sqlite');
  mkdirSync(path.dirname(intakeFile), { recursive: true });
  const intakeDb = new DatabaseSync(intakeFile);
  intakeDb.exec("CREATE TABLE intake_receipts(task_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,campaign_digest TEXT NOT NULL,source_digest TEXT NOT NULL,task_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;");
  intakeDb.prepare('INSERT INTO intake_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    firstTask.id, 'test-roadmap-campaign', inputDigest, initialPlan.campaignDigest, initialPlan.sourceDigest,
    'prior-task-digest', 'HOLD_PREFLIGHT', receiptJson, '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z',
  );
  const before = intakeDb.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(firstTask.id);
  intakeDb.close();

  const plan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(plan.status, 'READY_CANDIDATE');
  assert.equal(plan.selectedTaskId, secondTask.id);
  assert.equal(plan.candidates.find((candidate) => candidate.taskId === firstTask.id).status, 'HOLD_PREFLIGHT');
  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'READY');
  assert.equal(result.taskRecord.taskId, secondTask.id);
  assert.equal(result.candidates.find((candidate) => candidate.taskId === firstTask.id).code, 'AUTOMATIC_PREFLIGHT_BLOCKED');

  const verifyDb = new DatabaseSync(intakeFile, { readOnly: true });
  const after = verifyDb.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(firstTask.id);
  const firstHistory = verifyDb.prepare('SELECT COUNT(*) AS count FROM intake_receipt_history WHERE task_id=?').get(firstTask.id);
  verifyDb.close();
  assert.deepEqual(after, before);
  assert.equal(after.receipt_json, receiptJson);
  assert.equal(firstHistory.count, 0);
  assert.equal(realpathSync.native(priorWorktreeRoot), priorWorktreePathBefore);
  assert.equal(git(priorWorktreeRoot, ['rev-parse', 'HEAD']), priorWorktreeHeadBefore);
  assert.equal(git(priorWorktreeRoot, ['branch', '--show-current']), priorBranch);
  assert.equal(directorySnapshot(priorWorktreeRoot), priorWorktreeSnapshotBefore);
  assert.equal(readFileSync(markerFile, 'utf8'), 'preserve prior HOLD_PREFLIGHT worktree bytes\n');
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 3);
});

test('exclusions outside the trusted task allowlist are rejected', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const result = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile, excludeTaskIds: ['TASK-ZAI-002'] });
  assert.equal(result.status, 'HOLD_NOT_ALLOWED');
  assert.equal(result.code, 'EXCLUDE_TASK_ID_NOT_ALLOWED');
});

test('unaccepted dependencies produce a durable typed hold without creating a worktree or retrying', (t) => {
  const blocked = makeTask('TASK-ZAI-001', { status: 'planned', evidence: 'not done' });
  const task = makeTask('TASK-ZAI-002', { dependencies: ['TASK-ZAI-001'] });
  const f = fixture(t, [blocked, task], [task.id]);
  const first = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  const second = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(first.status, 'HOLD_DEPENDENCY');
  assert.equal(first.receiptCreated, true);
  assert.equal(second.receiptId, first.receiptId);
  assert.equal(second.receiptCreated, true);
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
});

test('roadmap rows cannot self-authorize an ID outside the trusted campaign allowlist', (t) => {
  const tasks = [makeTask('TASK-ZAI-001'),makeTask('TASK-ZAI-002')];
  const f = fixture(t, tasks, ['TASK-ZAI-002']);
  const result = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile, taskId: 'TASK-ZAI-001' });
  assert.equal(result.status, 'HOLD_NOT_ALLOWED');
  assert.equal(result.dispatchAllowed, false);
});

test('canonical acceptance omitted from root task plan holds for review before worktree creation', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const campaign = JSON.parse(readFileSync(f.campaignFile, 'utf8'));
  campaign.taskPlans[task.id].acceptance = [AC];
  writeFileSync(f.campaignFile, JSON.stringify(campaign, null, 2));
  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'HOLD_REVIEW_REQUIRED');
  assert.equal(result.code, 'CANONICAL_ACCEPTANCE_NOT_BOUND');
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
});

test('active delivery-controller write locks block conflicting intake', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const controllerDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite'));
  controllerDb.exec('CREATE TABLE delivery_write_locks(task_id TEXT,scope_path TEXT);');
  controllerDb.prepare('INSERT INTO delivery_write_locks VALUES(?,?)').run('TASK-ZAI-099','src/');
  controllerDb.close();
  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'HOLD_SCOPE_CONFLICT');
  assert.equal(result.code, 'ACTIVE_WRITE_SCOPE_CONFLICT');
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
});

test('a locked higher-priority task does not starve an independent ready task', (t) => {
  const first = makeTask('TASK-ZAI-001', { priority: 'P0' });
  const second = makeTask('TASK-ZAI-002', { priority: 'P1' });
  const f = fixture(t, [first, second]);
  const campaign = JSON.parse(readFileSync(f.campaignFile, 'utf8'));
  campaign.taskPlans[first.id].writeScope = ['src/shared/'];
  campaign.taskPlans[second.id].writeScope = ['src/independent/'];
  writeFileSync(f.campaignFile, JSON.stringify(campaign, null, 2));
  const controllerDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite'));
  controllerDb.exec('CREATE TABLE delivery_write_locks(task_id TEXT,scope_path TEXT);');
  controllerDb.prepare('INSERT INTO delivery_write_locks VALUES(?,?)').run('TASK-ZAI-099','src/shared/');
  controllerDb.close();

  const plan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(plan.status, 'READY_CANDIDATE');
  assert.equal(plan.selectedTaskId, second.id);
  assert.equal(plan.candidates.find((item) => item.taskId === first.id).status, 'HOLD_SCOPE_CONFLICT');
  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'READY');
  assert.equal(result.taskRecord.taskId, second.id);
  const receiptDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1', 'intake.sqlite'), { readOnly: true });
  assert.equal(receiptDb.prepare('SELECT 1 FROM intake_receipts WHERE task_id=?').get(first.id), undefined);
  assert.equal(receiptDb.prepare('SELECT state FROM intake_receipts WHERE task_id=?').get(second.id).state, 'READY');
  receiptDb.close();
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 2);
});

test('a lock-state change wakes a prior scope hold and admits the task', (t) => {
  const task = makeTask('TASK-ZAI-001', { priority: 'P0' });
  const f = fixture(t, [task]);
  const controllerDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite'));
  controllerDb.exec('CREATE TABLE delivery_write_locks(task_id TEXT,scope_path TEXT);');
  controllerDb.prepare('INSERT INTO delivery_write_locks VALUES(?,?)').run('TASK-ZAI-099','src/');
  controllerDb.close();

  const blocked = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  const repeated = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(blocked.status, 'HOLD_SCOPE_CONFLICT');
  assert.equal(blocked.receiptId, repeated.receiptId);
  const releaseDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite'));
  releaseDb.prepare('DELETE FROM delivery_write_locks WHERE task_id=?').run('TASK-ZAI-099');
  releaseDb.close();

  const admitted = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(admitted.status, 'READY');
  assert.equal(admitted.taskRecord.taskId, task.id);
  assert.notEqual(admitted.receiptId, blocked.receiptId);
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 2);
});

test('a post-claim scope hold is archived before lock-change reassessment', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const plan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  const inputDigest = createHash('sha256').update(JSON.stringify({
    campaignDigest: plan.campaignDigest,
    sourceDigest: plan.sourceDigest,
    taskId: task.id,
  })).digest('hex');
  const controllerDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite'));
  controllerDb.exec('CREATE TABLE delivery_write_locks(task_id TEXT,scope_path TEXT);');
  controllerDb.close();
  const intakeFile = path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1', 'intake.sqlite');
  mkdirSync(path.dirname(intakeFile), { recursive: true });
  const intakeDb = new DatabaseSync(intakeFile);
  intakeDb.exec("CREATE TABLE intake_receipts(task_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,campaign_digest TEXT NOT NULL,source_digest TEXT NOT NULL,task_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;");
  const oldReceipt = { schemaVersion: 'roadmap-intake-result/v1', status: 'HOLD_SCOPE_CONFLICT', code: 'ACTIVE_WRITE_SCOPE_CONFLICT', taskId: task.id, lockFingerprint: 'prior-lock-snapshot' };
  intakeDb.prepare('INSERT INTO intake_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(task.id, 'test-roadmap-campaign', inputDigest, plan.campaignDigest, plan.sourceDigest, 'prior-task-digest', 'HOLD_SCOPE_CONFLICT', JSON.stringify(oldReceipt), '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z');
  intakeDb.close();

  const admitted = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(admitted.status, 'READY');
  const historyDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1', 'intake.sqlite'), { readOnly: true });
  const history = historyDb.prepare('SELECT state,receipt_json,transition_reason,observed_lock_fingerprint FROM intake_receipt_history WHERE task_id=?').get(task.id);
  const current = historyDb.prepare('SELECT state FROM intake_receipts WHERE task_id=?').get(task.id);
  historyDb.close();
  assert.equal(history.state, 'HOLD_SCOPE_CONFLICT');
  assert.equal(history.receipt_json, JSON.stringify(oldReceipt));
  assert.equal(history.transition_reason, 'LOCK_STATE_CHANGED');
  assert.equal(history.observed_lock_fingerprint, plan.lockFingerprint);
  assert.equal(current.state, 'READY');
});

test('a mismatched unknown-effect receipt is reconciled after lock change without retry or mutation', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const initialPlan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  const branch = 'codex/roadmap-intake/' + task.id.toLowerCase();
  const worktreeRoot = path.join(path.dirname(f.repo), '.worktrees', 'roadmap-intake-v1', task.id.toLowerCase());
  const controllerFile = path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite');
  mkdirSync(path.dirname(controllerFile), { recursive: true });
  const controllerDb = new DatabaseSync(controllerFile);
  controllerDb.exec('CREATE TABLE delivery_write_locks(task_id TEXT,scope_path TEXT);');
  controllerDb.prepare('INSERT INTO delivery_write_locks VALUES(?,?)').run('TASK-ZAI-099', 'src/unrelated/');
  const locksBefore = controllerDb.prepare('SELECT task_id,scope_path FROM delivery_write_locks ORDER BY task_id,scope_path').all();
  controllerDb.close();

  const inputDigest = createHash('sha256').update(JSON.stringify({
    campaignDigest: initialPlan.campaignDigest,
    sourceDigest: initialPlan.sourceDigest,
    taskId: task.id,
  })).digest('hex');
  const receiptJson = JSON.stringify({
    schemaVersion: 'roadmap-intake-result/v1',
    status: 'INTAKE_PREPARING',
    code: 'INTAKE_CLAIMED',
    taskId: task.id,
    receiptId: 'unknown-effect-under-scope-hold',
    branch,
    worktreeRoot,
    baseCommit: f.base,
    lockFingerprint: initialPlan.lockFingerprint,
    authorityGrant: false,
    dispatchAllowed: false,
    checksExecuted: false,
  }, null, 2) + '\n';
  const intakeFile = path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1', 'intake.sqlite');
  mkdirSync(path.dirname(intakeFile), { recursive: true });
  const intakeDb = new DatabaseSync(intakeFile);
  intakeDb.exec("CREATE TABLE intake_receipts(task_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,campaign_digest TEXT NOT NULL,source_digest TEXT NOT NULL,task_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;");
  intakeDb.prepare('INSERT INTO intake_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    task.id, 'test-roadmap-campaign', inputDigest, initialPlan.campaignDigest, initialPlan.sourceDigest,
    'prior-task-digest', 'HOLD_SCOPE_CONFLICT', receiptJson, '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z',
  );
  const before = intakeDb.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(task.id);
  intakeDb.close();

  const plan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.notEqual(plan.lockFingerprint, initialPlan.lockFingerprint);
  assert.equal(plan.status, 'HOLD_RECONCILE');
  assert.equal(plan.code, 'INTAKE_INTERRUPTED_RECONCILIATION_REQUIRED');
  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'HOLD_RECONCILE');
  assert.equal(result.code, 'INTAKE_INTERRUPTED_RECONCILIATION_REQUIRED');

  const verifyDb = new DatabaseSync(intakeFile, { readOnly: true });
  const after = verifyDb.prepare('SELECT * FROM intake_receipts WHERE task_id=?').get(task.id);
  const history = verifyDb.prepare('SELECT COUNT(*) AS count FROM intake_receipt_history WHERE task_id=?').get(task.id);
  verifyDb.close();
  assert.deepEqual(after, before);
  assert.equal(after.receipt_json, receiptJson);
  assert.equal(history.count, 0);
  assert.equal(existsSync(worktreeRoot), false);
  assert.equal(git(f.repo, ['branch', '--list', branch]).trim(), '');
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
  const verifyControllerDb = new DatabaseSync(controllerFile, { readOnly: true });
  const locksAfter = verifyControllerDb.prepare('SELECT task_id,scope_path FROM delivery_write_locks ORDER BY task_id,scope_path').all();
  verifyControllerDb.close();
  assert.deepEqual(locksAfter, locksBefore);
});

test('unknown INTAKE_PREPARING receipt is reconciled and never replayed', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const plan = planRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  const inputDigest = createHash('sha256').update(JSON.stringify({
    campaignDigest: plan.campaignDigest,
    sourceDigest: plan.sourceDigest,
    taskId: task.id,
  })).digest('hex');
  const controllerDb = new DatabaseSync(path.join(f.common, 'zuri-delivery-control', 'controller-v1.sqlite'));
  controllerDb.exec('CREATE TABLE delivery_write_locks(task_id TEXT,scope_path TEXT);');
  controllerDb.close();
  const intakeFile = path.join(f.common, 'zuri-delivery-control', 'roadmap-intake-v1', 'intake.sqlite');
  mkdirSync(path.dirname(intakeFile), { recursive: true });
  const intakeDb = new DatabaseSync(intakeFile);
  intakeDb.exec("CREATE TABLE intake_receipts(task_id TEXT PRIMARY KEY,campaign_id TEXT NOT NULL,input_digest TEXT NOT NULL,campaign_digest TEXT NOT NULL,source_digest TEXT NOT NULL,task_digest TEXT NOT NULL,state TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;");
  const preparing = { schemaVersion: 'roadmap-intake-result/v1', status: 'INTAKE_PREPARING', code: 'INTAKE_CLAIMED', taskId: task.id, receiptId: 'unknown-effect' };
  intakeDb.prepare('INSERT INTO intake_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(task.id, 'test-roadmap-campaign', inputDigest, plan.campaignDigest, plan.sourceDigest, 'prior-task-digest', 'INTAKE_PREPARING', JSON.stringify(preparing), '2026-10-15T00:00:00.000Z', '2026-10-15T00:00:00.000Z');
  intakeDb.close();

  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'HOLD_RECONCILE');
  assert.equal(result.code, 'INTAKE_INTERRUPTED_RECONCILIATION_REQUIRED');
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
});

test('pre-existing deterministic branch is held without resetting or removing it', (t) => {
  const task = makeTask('TASK-ZAI-001');
  const f = fixture(t, [task]);
  const branch = 'codex/roadmap-intake/' + task.id.toLowerCase();
  git(f.repo, ['branch', branch, f.base]);
  const result = runRoadmapIntake({ repoRoot: f.repo, campaignFile: f.campaignFile });
  assert.equal(result.status, 'HOLD_COLLISION');
  assert.equal(result.code, 'WORKTREE_OR_BRANCH_EXISTS');
  assert.equal(git(f.repo, ['rev-parse', branch]), f.base);
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('worktree ').length - 1, 1);
});
