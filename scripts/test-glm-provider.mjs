// Fully offline: no env file is loaded and fetch is replaced before any call.
import './test-loader.mjs';
import assert from 'node:assert/strict';
const { GLMModelProvider, getRuntimeCapabilities } =
  await import('../lib/server/model-provider.ts');
const { assertSchema } = await import('../lib/server/schema-validator.ts');
const { projectSchemaFields } =
  await import('../lib/server/schema-projection.ts');
const { coordinatorSchema, investigatorSchema, dispositionSchema } =
  await import('../lib/server/model-contracts.ts');

process.env.GLM_API_KEY = 'unit-test-only-not-a-real-key';
process.env.GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
process.env.GLM_MODEL = 'glm-5.3-flash';
globalThis.fetch = async () => {
  throw new Error('Network disabled in offline tests');
};
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['ok'],
  properties: { ok: { type: 'boolean', const: true } },
};
const request = {
  stage: 'case_coordinator',
  instructions: 'Test only',
  input: { test: true },
  schemaName: 'test',
  schema,
};
const provider = new GLMModelProvider();
const success = (overrides = {}) => ({
  id: 'test-response-1',
  model: 'glm-5.3-flash',
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: '{"ok":true}',
        reasoning_content: 'PRIVATE_REASONING_SENTINEL',
      },
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 10 },
  ...overrides,
});
const stub = (payload, status = 200) => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), { status });
};
function fixture(s) {
  if ('const' in s) return s.const;
  if (s.enum) return s.enum[0];
  if (s.type === 'object')
    return Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, fixture(v)]),
    );
  if (s.type === 'array')
    return s.prefixItems
      ? s.prefixItems.map(fixture)
      : Array.from({ length: s.minItems ?? 1 }, () => fixture(s.items));
  if (s.type === 'boolean') return false;
  if (s.type === 'integer') return s.minimum ?? 1;
  return s.pattern?.startsWith('^RULE-')
    ? 'RULE-TEST'
    : s.pattern?.startsWith('^E-')
      ? 'E-TEST'
      : 'test';
}
for (const [name, contract] of Object.entries({
  coordinator: coordinatorSchema,
  investigator: investigatorSchema,
  disposition: dispositionSchema,
})) {
  await test(`${name} full schema accepts valid fixture`, () =>
    assertSchema(fixture(contract), contract));
  await test(`${name} rejects missing required field`, () => {
    const value = fixture(contract);
    delete value[contract.required[0]];
    assert.throws(() => assertSchema(value, contract));
  });
  await test(`${name} rejects unknown output field`, () =>
    assert.throws(() =>
      assertSchema(
        { ...fixture(contract), customerResponse: 'not allowed' },
        contract,
      ),
    ));
}
await test('tuple order and approval constants are enforced', () => {
  const value = fixture(dispositionSchema);
  value.responseConstraints.requiredApprovalFields.reverse();
  assert.throws(() => assertSchema(value, dispositionSchema));
  value.responseConstraints.requiredApprovalFields.reverse();
  value.approvalRequirement.required = false;
  assert.throws(() => assertSchema(value, dispositionSchema));
});
await test('extra-field diagnostics expose only allowlisted names, never values', () => {
  assert.throws(
    () => assertSchema({ ok: true, title: 'PRIVATE_VALUE' }, schema),
    (error) =>
      error.fieldHint === 'title' &&
      !JSON.stringify(error).includes('PRIVATE_VALUE'),
  );
  assert.throws(
    () => assertSchema({ ok: true, PRIVATE_KEY: 'PRIVATE_VALUE' }, schema),
    (error) =>
      error.fieldHint === 'UNRECOGNIZED' &&
      !JSON.stringify(error).includes('PRIVATE'),
  );
});
await test('request uses official endpoint and JSON mode; metadata excludes reasoning', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'glm-5.3-flash');
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.thinking.type, 'enabled');
    assert.equal(body.max_tokens, 4096);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return new Response(JSON.stringify(success()));
  };
  const result = await provider.generateStructured(request);
  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.metadata.inputTokens, 20);
  assert.equal(result.metadata.outputTokens, 10);
  assert.equal(result.metadata.responseId, 'test-response-1');
  assert.ok(!JSON.stringify(result).includes('PRIVATE_REASONING_SENTINEL'));
});
await test('missing token usage remains null rather than fabricated zero', async () => {
  stub(success({ usage: undefined, id: undefined }));
  const result = await provider.generateStructured(request);
  assert.equal(result.metadata.inputTokens, null);
  assert.equal(result.metadata.outputTokens, null);
  assert.equal(result.metadata.responseId, null);
});
await test('JSON adapter omits extra private fields without returning their names or values', async () => {
  stub(
    success({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: '{"ok":true,"PRIVATE_KEY":"PRIVATE_VALUE"}',
          },
        },
      ],
    }),
  );
  const result = await provider.generateStructured(request);
  assert.deepEqual(result.output, { ok: true });
  assert.equal(result.metadata.omittedFieldCount, 1);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
await test('nested projection preserves every declared value and the original input', () => {
  const expected = fixture(investigatorSchema);
  const original = structuredClone(expected);
  original.evidence[0].PRIVATE_KEY = { data: 'PRIVATE_VALUE' };
  original.conflicts[0].title = 'PRIVATE_VALUE';
  original.EXTRA_ROOT = true;
  const projected = projectSchemaFields(original, investigatorSchema);
  assert.deepEqual(projected.output, expected);
  assert.equal(projected.omittedFieldCount, 3);
  assert.equal(original.evidence[0].PRIVATE_KEY.data, 'PRIVATE_VALUE');
  assertSchema(projected.output, investigatorSchema);
});
await test('projection never repairs missing required fields, types, enums or approval constants', () => {
  const mutations = [
    (value) => {
      delete value.recommendation.actionCode;
    },
    (value) => {
      value.recommendation.actionCode = 'EXECUTE_REFUND';
    },
    (value) => {
      value.recommendation.evidenceIds = 'E-TEST';
    },
    (value) => {
      value.approvalRequirement.required = false;
    },
    (value) => {
      value.responseConstraints.requiredApprovalFields.reverse();
    },
    (value) => {
      value.responseConstraints.requiredApprovalFields.push('EXTRA');
    },
  ];
  for (const mutate of mutations) {
    const value = fixture(dispositionSchema);
    value.EXTRA_ROOT = 'ignored';
    mutate(value);
    assert.throws(() =>
      assertSchema(
        projectSchemaFields(value, dispositionSchema).output,
        dispositionSchema,
      ),
    );
  }
});
for (const [name, payload] of [
  [
    'truncated JSON',
    success({
      choices: [
        { finish_reason: 'length', message: { content: '{"ok":true}' } },
      ],
    }),
  ],
  [
    'invalid JSON',
    success({
      choices: [{ finish_reason: 'stop', message: { content: 'not json' } }],
    }),
  ],
  [
    'missing required field even with extra private field',
    success({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: '{"secret":"PRIVATE"}' },
        },
      ],
    }),
  ],
  [
    'wrong field type',
    success({
      choices: [
        { finish_reason: 'stop', message: { content: '{"ok":"true"}' } },
      ],
    }),
  ],
  ['different model', success({ model: 'other-model' })],
])
  await test(`rejects ${name}`, async () => {
    stub(payload);
    await assert.rejects(provider.generateStructured(request), {
      code: 'INVALID_OUTPUT',
    });
  });
for (const [status, expected, code] of [
  [401, 'AUTHENTICATION'],
  [403, 'AUTHENTICATION'],
  [402, 'QUOTA'],
  [400, 'QUOTA', '1113'],
  [429, 'RATE_LIMIT'],
  [500, 'UNAVAILABLE'],
]) {
  await test(`HTTP ${status} returns safe category ${expected}`, async () => {
    stub({ error: { code, message: 'PRIVATE_ERROR_SENTINEL' } }, status);
    await assert.rejects(
      provider.generateStructured(request),
      (error) =>
        error.code === expected &&
        !error.message.includes('PRIVATE_ERROR_SENTINEL'),
    );
  });
}
await test('timeout is safe and does not leak request details', async () => {
  globalThis.fetch = async () => {
    throw new DOMException('PRIVATE', 'TimeoutError');
  };
  await assert.rejects(provider.generateStructured(request), {
    code: 'TIMEOUT',
  });
});
await test('non-official URL rejected before key can be sent', () => {
  process.env.GLM_BASE_URL = 'https://untrusted.example/api';
  assert.equal(getRuntimeCapabilities().glm.available, false);
  assert.throws(() => new GLMModelProvider(), { code: 'INVALID_ENDPOINT' });
  process.env.GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
});
await test('missing key disables capability safely', () => {
  delete process.env.GLM_API_KEY;
  assert.equal(getRuntimeCapabilities().glm.available, false);
  assert.throws(() => new GLMModelProvider(), { code: 'NOT_CONFIGURED' });
});
console.log(`Offline GLM checks: ${passed}/${passed}`);
