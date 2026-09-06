import './test-loader.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prepareCandidate } from './model-candidate-fixtures.mjs';

const { mockDatabase } = await import('../lib/server/mock-database.ts');
const { runReadOnlyTool } = await import('../lib/server/mock-tools.ts');
const { assertInvestigationProviderAllowed } =
  await import('../lib/server/case-data-policy.ts');
const { investigateCase } =
  await import('../lib/server/pipeline-orchestrator.ts');
const { approveValidatedInvestigation, registerApprovalContext } =
  await import('../lib/server/approval-context.ts');

let requests = 0;
globalThis.fetch = async () => {
  requests++;
  throw new Error('OFFLINE_NETWORK_DISABLED');
};
delete process.env.GLM_CASE_DATA_PAUSED;

const datasetText = await readFile(
  new URL('../evals/model-candidates-v6.json', import.meta.url),
  'utf8',
);
const dataset = JSON.parse(datasetText);
const lock = JSON.parse(
  await readFile(
    new URL('../evals/model-candidates-v6.lock.json', import.meta.url),
    'utf8',
  ),
);

assert.equal(dataset.cases.length, 12);
assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 12);
assert.equal(dataset.status, 'FROZEN_FOR_GLM_EVALUATION');
assert.equal(dataset.version, lock.version);
assert.equal(
  createHash('sha256').update(datasetText).digest('hex'),
  lock.datasetSha256,
);
assert.deepEqual(
  Object.values(lock.batches).flat().sort(),
  dataset.cases.map((item) => item.id).sort(),
);

const original = JSON.stringify(mockDatabase);
for (const sample of dataset.cases) {
  const prepared = prepareCandidate(sample);
  assert.deepEqual(Object.keys(prepared.case).sort(), [
    'caseId',
    'channel',
    'customerId',
    'customerRequests',
    'loanId',
    'rawText',
    'receivedAt',
  ]);
  assert.ok(
    sample.expected.allowedActions.length &&
      sample.expected.allowedGates.length &&
      sample.expected.reviewChecks.length,
  );
  assert.equal(Object.hasOwn(prepared, 'expected'), false);
  assert.doesNotThrow(() =>
    assertInvestigationProviderAllowed('glm', prepared.case.caseId),
  );
  assert.deepEqual(prepared, prepareCandidate(sample));
}
assert.equal(JSON.stringify(mockDatabase), original);

let passed = 1;
console.log(
  'PASS 12 V6 candidate fixtures are isolated, expectation-free and registered only for GLM evaluation',
);

function test(name, fn) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}

const args = {
  customerId: 'CUST-1001',
  loanId: 'LOAN-3001',
  dateFrom: '2026-08-15',
  dateTo: '2026-08-15',
};

test('date boundaries use business timezone and include the complete end day', () => {
  const db = structuredClone(mockDatabase);
  const payment = db.transactions.find(
    (item) => item.transactionId === 'TXN-8159',
  );
  for (const [time, expected] of [
    ['2026-08-14T16:00:00Z', 'OK'],
    ['2026-08-15T15:59:59Z', 'OK'],
    ['2026-08-15T16:00:00Z', 'NOT_FOUND'],
  ]) {
    payment.initiatedAt = time;
    assert.equal(
      runReadOnlyTool(
        'get_payment_transactions',
        args,
        'fact_rule_investigator',
        db,
      ).status,
      expected,
    );
  }
});

test('invalid date ranges and invalid rule dates fail closed', () => {
  assert.equal(
    runReadOnlyTool(
      'get_payment_transactions',
      { ...args, dateFrom: '2026-08-16', dateTo: '2026-08-15' },
      'fact_rule_investigator',
    ).status,
    'ERROR',
  );
  assert.equal(
    runReadOnlyTool(
      'search_rules',
      { businessType: 'early_repayment_debit', effectiveAt: '2026-02-30' },
      'fact_rule_investigator',
    ).status,
    'ERROR',
  );
});

test('different customer and loan cannot be mixed by a date query', () => {
  assert.equal(
    runReadOnlyTool(
      'get_payment_transactions',
      { ...args, customerId: 'CUST-1002' },
      'fact_rule_investigator',
    ).status,
    'NOT_FOUND',
  );
});

test('V6 materializes multi-debit, missing-plan and timing boundaries', () => {
  const multiDebit = prepareCandidate(
    dataset.cases.find((item) => item.id === 'EVAL-V6-001'),
  );
  const addedDebit = multiDebit.database.transactions.find(
    (item) => item.transactionId === 'TXN-V6-001',
  );
  assert.equal(addedDebit.status, 'SUCCESS');
  assert.equal(addedDebit.amount, 1248.36);

  const missingPlan = prepareCandidate(
    dataset.cases.find((item) => item.id === 'EVAL-V6-002'),
  );
  assert.equal(
    missingPlan.database.schedules.some(
      (item) => item.scheduleId === 'SCHED-3001-06',
    ),
    false,
  );

  const preSettlement = prepareCandidate(
    dataset.cases.find((item) => item.id === 'EVAL-V6-003'),
  );
  assert.equal(
    preSettlement.database.transactions.find(
      (item) => item.transactionId === 'TXN-8159',
    ).completedAt,
    '2026-08-13T01:21:00+08:00',
  );
});

const stable = await investigateCase('CMP-2026-09002');
test('stable waiting-for-reversal workflow is approval-ready without claiming completion', () => {
  assert.equal(stable.recommendation.state, 'PENDING_APPROVAL');
  assert.equal(stable.recommendation.actionCode, 'WAIT_FOR_REVERSAL');
  registerApprovalContext(stable);
  assert.ok(approveValidatedInvestigation(stable.caseId, stable.runId));
});

assert.equal(requests, 0);
console.log(
  JSON.stringify({
    checks: passed,
    candidateCount: dataset.cases.length,
    candidateSha256: lock.datasetSha256,
    modelEvaluation: 'NOT_RUN',
    networkAttempts: requests,
  }),
);
