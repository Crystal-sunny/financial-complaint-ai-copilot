// Fully offline. Block fetch before importing application code; never load .env.
import './test-loader.mjs';
import assert from 'node:assert/strict';

let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error('Network disabled in case-data policy tests');
};
process.env.GLM_API_KEY = 'offline-glm-key-sentinel';
process.env.OPENAI_API_KEY = 'offline-openai-key-sentinel';
process.env.GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
process.env.GLM_MODEL = 'glm-5.3-flash';
process.env.GLM_CASE_DATA_PAUSED = 'true';
process.env.OPENAI_MODEL = 'gpt-5.4-mini';

const { getRuntimeCapabilities } =
  await import('../lib/server/model-provider.ts');
const { investigateCase } =
  await import('../lib/server/pipeline-orchestrator.ts');
const { mockDatabase } = await import('../lib/server/mock-database.ts');
const { GET: getRuntime } = await import('../app/api/runtime/route.ts');
const { POST: postInvestigation } =
  await import('../app/api/cases/[caseId]/investigate/route.ts');
const cases = mockDatabase.cases;
assert.equal(cases.length, 3);

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
const pausedCode = 'CASE_DATA_TRANSMISSION_PAUSED';
const stageIds = [
  'case_coordinator',
  'fact_rule_investigator',
  'disposition_compliance',
];
const expectedActions = {
  early_repayment_debit: 'PROPOSE_REFUND',
  duplicate_debit: 'WAIT_FOR_REVERSAL',
  suspected_fraud: 'ESCALATE_SECURITY',
};
const route = (caseId, body) =>
  postInvestigation(
    new Request('http://offline.test/api/investigate', {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ caseId }) },
  );

await test('configured credentials do not grant case transmission permission', () => {
  const runtime = getRuntimeCapabilities();
  assert.equal(runtime.defaultProvider, 'recorded');
  assert.equal(runtime.caseDataTransmission, 'paused');
  for (const name of ['glm', 'openai']) {
    assert.equal(runtime[name].configured, true);
    assert.equal(runtime[name].available, false);
  }
});

await test('runtime response exposes only configuration flags and model names', async () => {
  const response = await getRuntime();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const runtime = await response.json();
  assert.deepEqual(Object.keys(runtime).sort(), [
    'caseDataTransmission',
    'defaultProvider',
    'glm',
    'openai',
  ]);
  for (const name of ['glm', 'openai'])
    assert.deepEqual(Object.keys(runtime[name]).sort(), [
      'available',
      'configured',
      'model',
    ]);
  assert.ok(!JSON.stringify(runtime).includes('key-sentinel'));
});

await test('missing configuration remains distinguishable from paused configuration', () => {
  delete process.env.GLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const runtime = getRuntimeCapabilities();
  assert.equal(runtime.glm.configured, false);
  assert.equal(runtime.openai.configured, false);
  assert.equal(runtime.glm.available, false);
  assert.equal(runtime.caseDataTransmission, 'paused');
  process.env.GLM_API_KEY = 'offline-glm-key-sentinel';
  process.env.OPENAI_API_KEY = 'offline-openai-key-sentinel';
});

for (const caseItem of cases) {
  await test(`${caseItem.caseId} stable route returns all three safe Agent traces`, async () => {
    const response = await route(caseItem.caseId, { provider: 'recorded' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Execution-Mode'), 'recorded');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const result = await response.json();
    assert.equal(result.caseId, caseItem.caseId);
    assert.equal(result.execution.actualProvider, 'recorded');
    assert.equal(result.execution.fallbackUsed, false);
    assert.equal(result.execution.model, null);
    assert.equal(result.execution.validationChecks.length, 11);
    assert.ok(
      result.execution.validationChecks.every(
        (item) => item.status === 'PASSED',
      ),
    );
    assert.deepEqual(
      result.agentRuns.map((item) => item.stageId),
      stageIds,
    );
    assert.equal(
      result.recommendation.actionCode,
      expectedActions[caseItem.expectedType],
    );
    assert.equal(Object.hasOwn(result, 'responseDraft'), false);
    assert.equal(
      result.agentRuns[1].metrics.evidenceCount,
      result.evidence.length,
    );
    assert.equal(
      result.agentRuns[1].metrics.toolCalls,
      result.toolTraces.length,
    );
    const coordinatorInput = result.agentRuns[0].technicalDetails.input;
    assert.deepEqual(Object.keys(coordinatorInput).sort(), [
      'businessReference',
      'caseId',
      'channel',
      'complaintText',
      'customerReference',
      'receivedAt',
    ]);
    assert.notEqual(coordinatorInput.customerReference, caseItem.customerId);
    if (caseItem.loanId)
      assert.notEqual(coordinatorInput.businessReference, caseItem.loanId);
    for (const trace of result.agentRuns) {
      assert.equal(trace.provider, 'recorded');
      assert.equal(trace.status, 'COMPLETED');
      assert.ok(
        trace.inputSummary.length &&
          trace.actions.length &&
          trace.outputSummary.length,
      );
      assert.ok(Number.isFinite(trace.durationMs) && trace.durationMs >= 0);
      assert.equal(trace.metrics.inputTokens, null);
      assert.equal(trace.metrics.outputTokens, null);
      assert.equal(trace.technicalDetails.responseId, null);
      assert.equal(trace.technicalDetails.omittedFieldCount, null);
      assert.deepEqual(Object.keys(trace.technicalDetails).sort(), [
        'input',
        'omittedFieldCount',
        'output',
        'responseId',
      ]);
    }
    assert.ok(!JSON.stringify(result).includes('key-sentinel'));
  });

  for (const provider of ['glm', 'openai']) {
    await test(`${caseItem.caseId} direct ${provider} pipeline is blocked before fetch`, async () => {
      await assert.rejects(investigateCase(caseItem.caseId, { provider }), {
        code: pausedCode,
      });
      assert.equal(networkAttempts, 0);
    });
    await test(`${caseItem.caseId} ${provider} API returns explicit pause, not silent fallback`, async () => {
      const response = await route(caseItem.caseId, { provider });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('X-Execution-Mode'), null);
      const error = await response.json();
      assert.equal(error.error, pausedCode);
      assert.deepEqual(Object.keys(error).sort(), ['error', 'message']);
      assert.equal(networkAttempts, 0);
    });
  }
}

await test('client-supplied consent cannot override the owner pause', async () => {
  const response = await route(cases[0].caseId, {
    provider: 'glm',
    allowExternalCaseData: true,
    caseDataTransmission: 'allowed',
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, pausedCode);
});

for (const [name, body] of [
  ['unknown provider', { provider: 'unknown' }],
  ['provider array', { provider: ['glm'] }],
  ['null provider', { provider: null }],
  ['array body', []],
  ['null body', 'null'],
  ['malformed JSON', '{'],
]) {
  await test(`invalid request rejects ${name}`, async () => {
    const response = await route(cases[0].caseId, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_REQUEST');
  });
}

await test('empty request preserves the stable-mode default', async () => {
  const response = await route(cases[0].caseId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).execution.actualProvider, 'recorded');
});
await test('unknown cases return 404 without external requests', async () => {
  const response = await route('MISSING-CASE', { provider: 'glm' });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'CASE_NOT_FOUND');
});
await test('entire case regression suite made zero network attempts', () => {
  assert.equal(networkAttempts, 0);
});
console.log(
  `Offline case-data checks: ${passed}/${passed}; network attempts: ${networkAttempts}`,
);
