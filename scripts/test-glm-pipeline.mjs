// Offline GLM-path integration: replace all model fetches with contract fixtures.
import './test-loader.mjs';
import assert from 'node:assert/strict';
import { assessLiveResult } from './live-result-checks.mjs';
process.env.GLM_API_KEY = 'offline-only-key';
process.env.GLM_MODEL = 'glm-5.3-flash';
process.env.GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
delete process.env.GLM_CASE_DATA_PAUSED;
globalThis.fetch = async () => {
  throw new Error('Unexpected network attempt');
};
const { investigateCase, investigateSyntheticCaseForEvaluation } =
  await import('../lib/server/pipeline-orchestrator.ts');
const { getRuntimeCapabilities } =
  await import('../lib/server/model-provider.ts');
const { assertInvestigationProviderAllowed } =
  await import('../lib/server/case-data-policy.ts');
const { coordinatorSchema, investigatorSchema, dispositionSchema } =
  await import('../lib/server/model-contracts.ts');
const { mockDatabase } = await import('../lib/server/mock-database.ts');
const { POST } = await import('../app/api/cases/[caseId]/investigate/route.ts');
const { POST: approve } =
  await import('../app/api/cases/[caseId]/approval/route.ts');
const { registerApprovalContext } =
  await import('../lib/server/approval-context.ts');
const { readInvestigationStream } =
  await import('../lib/investigation-stream.ts');
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
function fixture(schema) {
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        fixture(value),
      ]),
    );
  if (schema.type === 'array')
    return schema.prefixItems
      ? schema.prefixItems.map(fixture)
      : Array.from({ length: schema.minItems ?? 1 }, () =>
          fixture(schema.items),
        );
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer') return schema.minimum ?? 1;
  return schema.pattern?.startsWith('^E-')
    ? 'E-TEST'
    : schema.pattern?.startsWith('^RULE-')
      ? 'RULE-TEST'
      : 'test';
}
function outputs(caseItem) {
  const coordinator = fixture(coordinatorSchema);
  coordinator.complaintType = caseItem.expectedType;
  const investigator = fixture(investigatorSchema);
  const source = mockDatabase.transactions.find(
    (item) =>
      item.customerId === caseItem.customerId &&
      [
        'SCHEDULED_DEBIT',
        'MANUAL_REPAYMENT_RETRY',
        'MERCHANT_PAYMENT',
      ].includes(item.type),
  );
  investigator.evidence[0].sourceRecordId = source.transactionId;
  investigator.evidence[0].evidenceType = 'PAYMENT_TRANSACTION';
  const rule = mockDatabase.rules.find((item) =>
    item.businessTypes.includes(caseItem.expectedType),
  );
  investigator.applicableRules[0].ruleId = rule.ruleId;
  investigator.conflicts = [];
  investigator.missingInformation = [];
  const disposition = fixture(dispositionSchema);
  disposition.recommendation.ruleIds = {
    early_repayment_debit: ['RULE-PAY-004', 'RULE-APPROVAL-002'],
    duplicate_debit: ['RULE-PAY-005'],
    suspected_fraud: ['RULE-SECURITY-001', 'RULE-SECURITY-002'],
  }[caseItem.expectedType];
  disposition.recommendation.actionCode = {
    early_repayment_debit: 'PROPOSE_REFUND',
    duplicate_debit: 'WAIT_FOR_REVERSAL',
    suspected_fraud: 'ESCALATE_SECURITY',
  }[caseItem.expectedType];
  disposition.recommendation.state =
    caseItem.expectedType === 'suspected_fraud'
      ? 'MANDATORY_ESCALATION'
      : 'PENDING_APPROVAL';
  if (caseItem.expectedType === 'duplicate_debit') {
    investigator.evidence.push({
      ...investigator.evidence[0],
      evidenceId: 'E-REVERSAL',
      evidenceType: 'REVERSAL_TRANSACTION',
      sourceRecordId: 'REV-8201',
    });
    disposition.recommendation.evidenceIds.push('E-REVERSAL');
    disposition.approvalRequirement.level = 'CASE_SPECIALIST';
  }
  if (caseItem.expectedType === 'suspected_fraud')
    disposition.approvalRequirement.level = 'SECURITY_TEAM';
  return [coordinator, investigator, disposition];
}
function stub(caseItem, mutate = (value) => value) {
  let calls = 0;
  const values = outputs(caseItem);
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    const body = JSON.parse(options.body);
    const inputText = body.messages[1].content;
    assert.ok(
      !inputText.includes('expectedType') &&
        !inputText.includes('expectedRiskLevel'),
    );
    assert.ok(!inputText.includes('offline-only-key'));
    if (calls === 1) {
      const input = JSON.parse(inputText);
      assert.ok(
        input.recordSemantics.status.SUCCESS_AFTER_TIMEOUT.includes('最终成功'),
      );
      assert.ok(input.recordSemantics.relation.includes('不得虚构'));
    }
    const output = mutate(structuredClone(values[calls]), calls);
    calls++;
    return Response.json({
      id: `offline-response-${calls}`,
      model: 'glm-5.3-flash',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify(output),
            reasoning_content: 'DO_NOT_EXPOSE',
          },
        },
      ],
      usage: { prompt_tokens: 10 * calls, completion_tokens: 5 * calls },
    });
  };
  return () => calls;
}
await test('authorization enables configured GLM but does not authorize OpenAI or additional cases', () => {
  assert.equal(getRuntimeCapabilities().defaultProvider, 'glm');
  assert.equal(getRuntimeCapabilities().glm.available, true);
  assert.equal(getRuntimeCapabilities().openai.available, false);
  assert.throws(() =>
    assertInvestigationProviderAllowed('openai', mockDatabase.cases[0].caseId),
  );
  assert.throws(() =>
    assertInvestigationProviderAllowed('glm', 'UNAUTHORIZED-CASE'),
  );
});
await test('isolated synthetic evaluation uses its supplied database and has no recorded fallback', async () => {
  const caseItem = {
    ...mockDatabase.cases[0],
    caseId: 'EVAL-V2-003',
    customerRequests: ['核验客户描述，但数据库中缺少所称成功流水。'],
  };
  const database = structuredClone(mockDatabase);
  database.transactions = database.transactions.filter(
    (item) => item.transactionId !== 'TXN-8159',
  );
  const calls = stub(mockDatabase.cases[0]);
  await assert.rejects(
    investigateSyntheticCaseForEvaluation(caseItem, database),
    (error) => error?.code === 'MODEL_SOURCE_REFERENCE',
  );
  assert.equal(calls(), 3);
});
await test('non-template transaction denial triggers deterministic security escalation', async () => {
  const base = mockDatabase.cases[2];
  const caseItem = {
    ...base,
    caseId: 'EVAL-V2-011',
    rawText:
      '昨晚手机一直在我床头，凌晨连续发生的三笔消费我完全没有进行过，也没让别人替我操作。',
    customerRequests: ['核验三笔并确认账户安全。'],
  };
  const calls = stub(base);
  const result = await investigateSyntheticCaseForEvaluation(
    caseItem,
    structuredClone(mockDatabase),
  );
  assert.equal(calls(), 3);
  assert.equal(result.coordinator.mandatoryEscalation, true);
  assert.equal(result.evidenceGate, 'MANDATORY_ESCALATION');
  assert.equal(result.recommendation.actionCode, 'ESCALATE_SECURITY');
});
await test('insufficient evidence without a conflict remains visibly unresolved', async () => {
  stub(mockDatabase.cases[0], (value, index) => {
    if (index === 1) {
      value.conflicts = [];
      value.evidenceGate.status = 'INSUFFICIENT';
      value.evidenceGate.reason = '关键支付记录仍需补充核验。';
    }
    if (index === 2) {
      value.recommendation.actionCode = 'REQUEST_INFORMATION';
      value.recommendation.state = 'NEEDS_INFORMATION';
      value.approvalRequirement.level = 'CASE_SPECIALIST';
    }
    return value;
  });
  const result = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
  });
  assert.equal(result.execution.actualProvider, 'glm');
  assert.equal(result.conflict.status, 'UNRESOLVED');
  assert.equal(result.conflict.title, '调查结论仍需补充核验');
});
for (const caseItem of mockDatabase.cases) {
  await test(`${caseItem.caseId} GLM path preserves stage order, tokens and scoped inputs`, async () => {
    const calls = stub(caseItem);
    const events = [];
    const result = await investigateCase(caseItem.caseId, {
      provider: 'glm',
      onEvent: (event) => events.push(event),
    });
    assert.equal(calls(), 3);
    assert.equal(result.mode, 'GLM');
    assert.equal(result.execution.actualProvider, 'glm');
    assert.equal(result.execution.fallbackUsed, false);
    assert.deepEqual(
      events.map((event) => event.stageId),
      result.agentRuns.map((agent) => agent.stageId),
    );
    assert.ok(
      result.agentRuns.every(
        (agent, index) =>
          agent.provider === 'glm' &&
          agent.metrics.inputTokens === (index + 1) * 10 &&
          agent.technicalDetails.responseId === `offline-response-${index + 1}`,
      ),
    );
    assert.ok(!JSON.stringify(result).includes('DO_NOT_EXPOSE'));
    if (caseItem.expectedType === 'suspected_fraud')
      assert.equal(result.evidenceGate, 'MANDATORY_ESCALATION');
  });
}
await test('refund amount comes from the disputed debit, not earlier settlement', async () => {
  stub(mockDatabase.cases[0], (value, index) => {
    if (index === 1)
      value.evidence.unshift({
        ...value.evidence[0],
        evidenceId: 'E-EARLY',
        sourceRecordId: 'TXN-8101',
      });
    if (index === 2) value.recommendation.evidenceIds.unshift('E-EARLY');
    return value;
  });
  const result = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
  });
  assert.equal(result.execution.actualProvider, 'glm');
  assert.equal(result.recommendation.amount, 1248.36);
});
await test('extra model fields are omitted and the count is traceable without exposing content', async () => {
  stub(mockDatabase.cases[0], (value, index) => {
    if (index === 1) value.evidence[0].PRIVATE_KEY = 'PRIVATE_VALUE';
    return value;
  });
  const result = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
  });
  assert.equal(result.execution.actualProvider, 'glm');
  assert.equal(result.agentRuns[1].technicalDetails.omittedFieldCount, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(result.recommendation.amount, 1248.36);
});
await test('missing required evidence field still causes full safe fallback without a disposition call', async () => {
  const calls = stub(mockDatabase.cases[0], (value, index) => {
    if (index === 1) {
      delete value.evidence[0].claim;
      value.evidence[0].EXTRA = 'PRIVATE_VALUE';
    }
    return value;
  });
  const result = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
  });
  assert.equal(calls(), 2);
  assert.equal(result.execution.actualProvider, 'recorded');
  assert.ok(result.execution.fallbackReason.includes('MISSING_FIELD'));
  assert.ok(
    result.agentRuns.every(
      (agent) => agent.technicalDetails.omittedFieldCount === null,
    ),
  );
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
await test('a late-stage invalid reference discards every model trace on fallback', async () => {
  const calls = stub(mockDatabase.cases[0], (value, index) => {
    if (index === 2) value.recommendation.evidenceIds = ['E-NONEXISTENT'];
    return value;
  });
  const events = [];
  const result = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
    onEvent: (event) => events.push(event),
  });
  assert.equal(calls(), 3);
  assert.equal(result.execution.requestedProvider, 'glm');
  assert.equal(result.execution.actualProvider, 'recorded');
  assert.equal(result.execution.fallbackUsed, true);
  assert.equal(events.at(-1).type, 'fallback');
  assert.ok(
    result.agentRuns.every(
      (agent) =>
        agent.provider === 'recorded' &&
        agent.metrics.inputTokens === null &&
        agent.technicalDetails.responseId === null,
    ),
  );
});
await test('provider errors return safe fallback reason with no raw output', async () => {
  globalThis.fetch = async () =>
    Response.json({ error: { message: 'PRIVATE_SENTINEL' } }, { status: 429 });
  const result = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
  });
  assert.ok(result.execution.fallbackReason.includes('频率受限'));
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
});
await test('aborted investigation makes no model request and does not fake a completed fallback', async () => {
  const calls = stub(mockDatabase.cases[0]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    investigateCase(mockDatabase.cases[0].caseId, {
      provider: 'glm',
      signal: controller.signal,
    }),
  );
  assert.equal(calls(), 0);
});
await test('streaming route sends only stage events followed by validated completion', async () => {
  stub(mockDatabase.cases[0]);
  const response = await POST(
    new Request('http://offline.test', {
      method: 'POST',
      headers: { Accept: 'application/x-ndjson' },
      body: JSON.stringify({ provider: 'glm' }),
    }),
    { params: Promise.resolve({ caseId: mockDatabase.cases[0].caseId }) },
  );
  const events = [];
  const result = await readInvestigationStream(response, (event) =>
    events.push(event),
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ['stage_started', 'stage_started', 'stage_started', 'completed'],
  );
  assert.equal(result.execution.actualProvider, 'glm');
  assert.ok(
    events
      .slice(0, -1)
      .every(
        (event) =>
          Object.keys(event).sort().join(',') === 'provider,stageId,type',
      ),
  );
});
await test('stream decoder handles Chinese split across single-byte chunks', async () => {
  const result = await investigateCase(mockDatabase.cases[0].caseId);
  const bytes = new TextEncoder().encode(
    JSON.stringify({ type: 'completed', result }),
  );
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const parsed = await readInvestigationStream(
    new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
    () => {},
  );
  assert.deepEqual(parsed, result);
});
await test('truncated stream cannot be mistaken for successful investigation', async () => {
  await assert.rejects(
    readInvestigationStream(
      new Response(
        '{"type":"stage_started","stageId":"case_coordinator","provider":"glm"}\n',
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      ),
      () => {},
    ),
  );
});
const approvalRequest = (caseId, runId) =>
  approve(
    new Request('http://offline.test', {
      method: 'POST',
      body: JSON.stringify({ runId }),
    }),
    { params: Promise.resolve({ caseId }) },
  );
await test('approval requires a real server-validated run, not client assertions', async () => {
  const response = await approvalRequest(
    mockDatabase.cases[0].caseId,
    'FAKE-RUN',
  );
  assert.equal(response.status, 409);
  assert.equal(Object.hasOwn(await response.json(), 'responseDraft'), false);
});
await test('supported validated decision can generate the approved reply', async () => {
  const result = await investigateCase(mockDatabase.cases[0].caseId);
  registerApprovalContext(result);
  const response = await approvalRequest(result.caseId, result.runId);
  assert.equal(response.status, 200);
  const approval = await response.json();
  assert.ok(
    approval.responseDraft && approval.executionDeadline && approval.decision,
  );
  assert.equal(
    (await approvalRequest(mockDatabase.cases[1].caseId, result.runId)).status,
    409,
  );
});
await test('model evidence conflict cannot enter approval or generate a canned reply', async () => {
  stub(mockDatabase.cases[1], (value, index) => {
    if (index === 1) value.evidenceGate.status = 'CONFLICT_BLOCKED';
    if (index === 2) {
      value.recommendation.actionCode = 'REQUEST_INFORMATION';
      value.recommendation.state = 'NEEDS_INFORMATION';
    }
    return value;
  });
  const result = await investigateCase(mockDatabase.cases[1].caseId, {
    provider: 'glm',
  });
  assert.equal(result.execution.actualProvider, 'glm');
  registerApprovalContext(result);
  assert.equal(
    (await approvalRequest(result.caseId, result.runId)).status,
    409,
  );
  stub(mockDatabase.cases[0], (value, index) => {
    if (index === 1) {
      const conflict = {
        description: '记录矛盾',
        leftEvidenceIds: ['E-TEST'],
        rightEvidenceIds: ['E-TEST'],
        resolution: 'RESOLVED',
        nextAction: '核验',
      };
      value.conflicts = [conflict, { ...conflict, resolution: 'UNRESOLVED' }];
    }
    return value;
  });
  const hiddenConflict = await investigateCase(mockDatabase.cases[0].caseId, {
    provider: 'glm',
  });
  assert.equal(hiddenConflict.execution.actualProvider, 'recorded');
  assert.ok(
    hiddenConflict.execution.fallbackReason.includes('FINANCIAL_ACTION_GATE'),
  );
});
await test('waiting for reversal uses specialist review and safely rejects a refund approver', async () => {
  for (const level of ['CASE_SPECIALIST', 'L1_SUPERVISOR']) {
    stub(mockDatabase.cases[1], (value, index) => {
      if (index === 2) value.approvalRequirement.level = level;
      return value;
    });
    const result = await investigateCase(mockDatabase.cases[1].caseId, {
      provider: 'glm',
    });
    assert.equal(
      result.execution.actualProvider,
      level === 'CASE_SPECIALIST' ? 'glm' : 'recorded',
    );
    assert.equal(result.execution.fallbackUsed, level !== 'CASE_SPECIALIST');
    if (level !== 'CASE_SPECIALIST')
      assert.ok(
        result.execution.fallbackReason.includes('DISPOSITION_RULE_BINDING'),
      );
    assert.equal(result.approval.level, 'CASE_SPECIALIST');
    assert.equal(result.recommendation.amount, 588.2);
    registerApprovalContext(result);
    const response = await approvalRequest(result.caseId, result.runId);
    assert.equal(response.status, 200);
  }
});
await test('rerunning a case invalidates its previous approval context', async () => {
  const older = await investigateCase(mockDatabase.cases[0].caseId);
  registerApprovalContext(older);
  const newer = await investigateCase(mockDatabase.cases[0].caseId);
  registerApprovalContext(newer);
  assert.notEqual(newer.runId, older.runId);
  assert.equal((await approvalRequest(older.caseId, older.runId)).status, 409);
});
await test('live assessment separates fallback, format success and business success', async () => {
  const recorded = await investigateCase(mockDatabase.cases[1].caseId);
  assert.equal(assessLiveResult(recorded).businessPassed, false);
  assert.ok(
    assessLiveResult(recorded).businessChecks.every(
      (check) => check.status === 'NOT_EVALUATED',
    ),
  );
  stub(mockDatabase.cases[1]);
  const result = await investigateCase(mockDatabase.cases[1].caseId, {
    provider: 'glm',
  });
  assert.equal(assessLiveResult(result).businessPassed, true);
  result.approval.level = 'L1_SUPERVISOR';
  const assessment = assessLiveResult(result);
  assert.equal(assessment.modelContractPassed, true);
  assert.equal(assessment.businessPassed, false);
  assert.ok(
    assessment.businessChecks.some(
      (check) => check.field === 'approval' && check.status === 'FAILED',
    ),
  );
});
console.log(`Offline GLM pipeline checks: ${passed}/${passed}`);
