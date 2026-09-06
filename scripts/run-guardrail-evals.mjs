// This runner uses real application modules, never a model or guessed answers.
import './test-loader.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.env.GLM_CASE_DATA_PAUSED = 'true';
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error('OFFLINE_NETWORK_DISABLED');
};
const { mockDatabase } = await import('../lib/server/mock-database.ts');
const { runReadOnlyTool } = await import('../lib/server/mock-tools.ts');
const { investigateRecordedCase } =
  await import('../lib/server/recorded-orchestrator.ts');
const { validateInvestigation, InvestigationValidationError } =
  await import('../lib/server/safety-validator.ts');
const { assertInvestigationProviderAllowed } =
  await import('../lib/server/case-data-policy.ts');
const { dispositionSchema } = await import('../lib/server/model-contracts.ts');
const { assertSchema, SchemaValidationError } =
  await import('../lib/server/schema-validator.ts');
const { projectSchemaFields } =
  await import('../lib/server/schema-projection.ts');
const source = await readFile(
  new URL('../evals/guardrails-v1.json', import.meta.url),
  'utf8',
);
const dataset = JSON.parse(source);
assert.equal(
  dataset.scope,
  'offline-application-regression-not-model-accuracy',
);
assert.equal(dataset.cases.length, 31);
assert.equal(
  new Set(dataset.cases.map((item) => item.id)).size,
  dataset.cases.length,
);

function applyPatches(value, patches = []) {
  for (const { path, value: replacement } of patches) {
    assert.ok(Array.isArray(path) && path.length);
    assert.ok(
      !path.some((key) =>
        ['__proto__', 'constructor', 'prototype'].includes(key),
      ),
    );
    let target = value;
    for (const key of path.slice(0, -1)) {
      assert.ok(Object.hasOwn(target, key), 'Unknown patch path');
      target = target[key];
    }
    target[path.at(-1)] = structuredClone(replacement);
  }
}
function schemaFixture(schema) {
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [
        key,
        schemaFixture(value),
      ]),
    );
  if (schema.type === 'array')
    return schema.prefixItems
      ? schema.prefixItems.map(schemaFixture)
      : Array.from({ length: schema.minItems ?? 1 }, () =>
          schemaFixture(schema.items),
        );
  if (schema.type === 'boolean') return true;
  return schema.pattern?.startsWith('^E-')
    ? 'E-TEST'
    : schema.pattern?.startsWith('^RULE-')
      ? 'RULE-TEST'
      : 'test';
}
function recordId(record) {
  return (
    record.transactionId ??
    record.ruleId ??
    record.eventId ??
    record.loanId ??
    record.scheduleId
  );
}
function applyDatabaseChanges(database, changes = []) {
  for (const patch of changes) {
    assert.ok(
      ['transactions', 'rules', 'securityEvents', 'schedules'].includes(
        patch.collection,
      ),
    );
    const index = database[patch.collection].findIndex(
      (item) => recordId(item) === patch.id,
    );
    assert.ok(index >= 0, 'Unknown database patch target');
    if (patch.remove) database[patch.collection].splice(index, 1);
    else Object.assign(database[patch.collection][index], patch.set);
  }
}
function evaluate(sample) {
  if (sample.kind === 'validation') {
    const caseItem = mockDatabase.cases.find(
      (item) => item.caseId === (sample.baseCaseId ?? 'CMP-2026-09001'),
    );
    assert.ok(caseItem, 'Unknown validation base case');
    const database = structuredClone(mockDatabase);
    const result = structuredClone(investigateRecordedCase(caseItem.caseId));
    const context = {
      validSourceRecordIds: new Set(
        result.evidence.map((item) => item.sourceRecordId),
      ),
      validRuleIds: new Set(result.recommendation.ruleIds),
      currentCustomerId: caseItem.customerId,
      currentLoanId: caseItem.loanId,
      transactionRecords: database.transactions,
      scheduleRecords: database.schedules,
    };
    // Positive control: a broken or deny-all validator must fail this suite.
    validateInvestigation(result, context);
    applyDatabaseChanges(database, sample.databaseChanges);
    applyPatches(result, sample.patches);
    for (const patch of sample.tracePatches ?? []) {
      const trace = result.toolTraces.find((item) => item.name === patch.name);
      assert.ok(trace, 'Unknown trace patch target');
      Object.assign(trace, patch.changes);
    }
    let rejection = null;
    try {
      validateInvestigation(result, context);
    } catch (error) {
      if (!(error instanceof InvestigationValidationError)) throw error;
      rejection = error.code;
    }
    assert.equal(rejection, sample.expectedError);
    return { rejection };
  }
  if (sample.kind === 'tool') {
    const database = structuredClone(mockDatabase);
    applyDatabaseChanges(database, sample.databaseChanges);
    const snapshot = JSON.stringify(database);
    const response = runReadOnlyTool(
      sample.tool,
      sample.args,
      'fact_rule_investigator',
      database,
    );
    assert.equal(
      JSON.stringify(database),
      snapshot,
      'Read-only tool modified its data',
    );
    assert.equal(response.status, sample.expected.status);
    const ids = (
      Array.isArray(response.data)
        ? response.data
        : response.data
          ? [response.data]
          : []
    ).map(recordId);
    for (const id of sample.expected.includes ?? [])
      assert.ok(ids.includes(id), `Missing expected record ${id}`);
    for (const id of sample.expected.excludes ?? [])
      assert.ok(!ids.includes(id), `Unexpected record ${id}`);
    if (response.status !== 'OK') assert.equal(response.data, null);
    return { status: response.status, recordIds: ids };
  }
  if (sample.kind === 'tool_permission') {
    assert.throws(
      () => runReadOnlyTool(sample.tool, { loanId: 'LOAN-3001' }, sample.actor),
      /^Error: DENY_AND_AUDIT:/,
    );
    return { denied: true };
  }
  if (sample.kind === 'transmission_permission') {
    // The per-case allowlist, not the temporary kill switch, must reject it.
    delete process.env.GLM_CASE_DATA_PAUSED;
    try {
      assert.throws(
        () => assertInvestigationProviderAllowed('glm', sample.caseId),
        { code: 'CASE_DATA_TRANSMISSION_PAUSED' },
      );
    } finally {
      process.env.GLM_CASE_DATA_PAUSED = 'true';
    }
    return { denied: true };
  }
  if (sample.kind === 'schema') {
    assert.equal(sample.schema, 'disposition');
    const output = schemaFixture(dispositionSchema);
    assertSchema(output, dispositionSchema);
    applyPatches(output, sample.patches);
    assert.throws(
      () =>
        assertSchema(
          projectSchemaFields(output, dispositionSchema).output,
          dispositionSchema,
        ),
      SchemaValidationError,
    );
    return { rejectedAfterProjection: true };
  }
  throw new Error('Unknown evaluation kind');
}

const untouchedDatabase = JSON.stringify(mockDatabase);
// Include all three valid workflows so restrictive fixes cannot just deny all.
for (const item of mockDatabase.cases) {
  const result = investigateRecordedCase(item.caseId);
  validateInvestigation(result, {
    validSourceRecordIds: new Set(
      result.evidence.map((evidence) => evidence.sourceRecordId),
    ),
    validRuleIds: new Set(result.recommendation.ruleIds),
    currentCustomerId: item.customerId,
    currentLoanId: item.loanId,
    transactionRecords: mockDatabase.transactions,
    scheduleRecords: mockDatabase.schedules,
  });
}
const results = dataset.cases.map((sample) => {
  const startedAt = performance.now();
  try {
    return {
      id: sample.id,
      category: sample.category,
      name: sample.name,
      passed: true,
      actual: evaluate(sample),
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      id: sample.id,
      category: sample.category,
      name: sample.name,
      passed: false,
      diagnostic:
        error instanceof assert.AssertionError
          ? 'ASSERTION_MISMATCH'
          : 'RUNNER_ERROR',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
});
assert.equal(
  JSON.stringify(mockDatabase),
  untouchedDatabase,
  'Evaluation polluted the app database',
);
assert.equal(networkAttempts, 0);
const report = {
  generatedAt: new Date().toISOString(),
  datasetVersion: dataset.version,
  datasetSha256: createHash('sha256').update(source).digest('hex'),
  mode: dataset.scope,
  modelEvaluation: 'NOT_RUN',
  modelAccuracy: null,
  networkAttempts,
  total: results.length,
  passed: results.filter((item) => item.passed).length,
  results,
};
report.failed = report.total - report.passed;
const markdown = `# 应用护栏真实代码回归\n\n- 时间：${report.generatedAt}\n- 版本：${report.datasetVersion}\n- 数据集 SHA256：${report.datasetSha256}\n- 通过：${report.passed}/${report.total}\n- 外部请求：${networkAttempts}\n- 模型评测：未运行；模型准确率：不适用\n\n| 场景 | 名称 | 结果 |\n|---|---|---|\n${results.map((item) => `| ${item.id} | ${item.name} | ${item.passed ? '通过' : '失败'} |`).join('\n')}\n\n结果只代表程序护栏，不代表模型语言理解、事实推理或提示注入识别率。\n`;
const directory = new URL('../evals/results/', import.meta.url);
await mkdir(directory, { recursive: true });
const filename = `guardrails-v1-${Date.now()}`;
await writeFile(
  new URL(`${filename}.json`, directory),
  JSON.stringify(report, null, 2),
);
await writeFile(new URL(`${filename}.md`, directory), markdown);
console.log(
  JSON.stringify({
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    modelEvaluation: report.modelEvaluation,
    networkAttempts,
    report: fileURLToPath(new URL(`${filename}.json`, directory)),
  }),
);
for (const result of results)
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} ${result.name}`);
if (report.failed) process.exitCode = 1;
