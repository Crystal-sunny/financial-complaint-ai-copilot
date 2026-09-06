import './test-loader.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
async function loadSuite(suite) {
  const text = await readFile(
    new URL(`../evals/model-candidates-${suite}.json`, import.meta.url),
    'utf8',
  );
  return {
    text,
    dataset: JSON.parse(text),
    lock: JSON.parse(
      await readFile(
        new URL(
          `../evals/model-candidates-${suite}.lock.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  };
}
const suites = await Promise.all(['v2', 'v3'].map(loadSuite));
for (const { text, dataset, lock } of suites) {
  assert.equal(dataset.cases.length, 12);
  assert.equal(new Set(dataset.cases.map((item) => item.id)).size, 12);
  assert.equal(dataset.status, 'AUTHORIZED_FOR_AUTOMATIC_GLM_EVALUATION');
  assert.equal(dataset.version, lock.version);
  assert.equal(
    createHash('sha256').update(text).digest('hex'),
    lock.datasetSha256,
  );
  assert.deepEqual(
    Object.values(lock.batches).flat().sort(),
    dataset.cases.map((item) => item.id).sort(),
  );
}
const [{ text, dataset }, { text: holdoutText, dataset: holdout }] = suites;
const original = JSON.stringify(mockDatabase);
for (const sample of [...dataset.cases, ...holdout.cases]) {
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
  const again = prepareCandidate(sample);
  assert.deepEqual(prepared, again);
  prepared.database.transactions.length = 0;
  assert.ok(again.database.transactions.length > 0);
}
assert.throws(() => assertInvestigationProviderAllowed('glm', 'EVAL-V4-001'), {
  code: 'CASE_DATA_TRANSMISSION_PAUSED',
});
assert.equal(JSON.stringify(mockDatabase), original);
let passed = 1;
console.log(
  'PASS 24 candidate fixtures are isolated, expectation-free model inputs and authorized only for GLM evaluation',
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
test('reversed dates and invalid leap-day dates return explicit errors', () => {
  for (const query of [
    { dateFrom: '2026-08-16', dateTo: '2026-08-15' },
    { dateFrom: '2026-02-29' },
    { dateTo: '' },
  ])
    assert.equal(
      runReadOnlyTool(
        'get_payment_transactions',
        { ...args, ...query },
        'fact_rule_investigator',
      ).status,
      'ERROR',
    );
});
test('invalid effective date never returns a broad rule set', () => {
  for (const effectiveAt of [undefined, '2026-02-30'])
    assert.equal(
      runReadOnlyTool(
        'search_rules',
        { businessType: 'early_repayment_debit', effectiveAt },
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
test('materialized candidates actually apply missing data and amount changes', () => {
  const missing = prepareCandidate(
    dataset.cases.find((item) => item.id === 'EVAL-V2-003'),
  );
  assert.equal(
    runReadOnlyTool(
      'get_payment_transactions',
      args,
      'fact_rule_investigator',
      missing.database,
    ).status,
    'NOT_FOUND',
  );
  const high = prepareCandidate(
    dataset.cases.find((item) => item.id === 'EVAL-V2-009'),
  );
  assert.equal(
    high.database.transactions.find((item) => item.transactionId === 'TXN-8159')
      .amount,
    2000.01,
  );
  assert.equal(
    high.database.schedules.find((item) => item.scheduleId === 'SCHED-3001-06')
      .total,
    2000.01,
  );
});
test('V3 holdout materializes boundary amounts and preserves customer-loan isolation', () => {
  const boundary = prepareCandidate(
    holdout.cases.find((item) => item.id === 'EVAL-V3-001'),
  );
  assert.equal(
    boundary.database.transactions.find(
      (item) => item.transactionId === 'TXN-8159',
    ).amount,
    2000,
  );
  const crossCustomer = prepareCandidate(
    holdout.cases.find((item) => item.id === 'EVAL-V3-010'),
  );
  assert.equal(
    runReadOnlyTool(
      'get_loan_contract',
      {
        customerId: crossCustomer.case.customerId,
        loanId: crossCustomer.case.loanId,
      },
      'fact_rule_investigator',
      crossCustomer.database,
    ).status,
    'NOT_FOUND',
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
    candidateCount: 24,
    candidateSha256: {
      v2: createHash('sha256').update(text).digest('hex'),
      v3: createHash('sha256').update(holdoutText).digest('hex'),
    },
    modelEvaluation: 'NOT_RUN',
    networkAttempts: requests,
  }),
);
