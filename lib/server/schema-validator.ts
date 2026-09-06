// Checks the JSON Schema vocabulary used by our three agent contracts.
// JSON mode alone guarantees neither the fields nor their business meaning.
export class SchemaValidationError extends Error {
  constructor(
    readonly fieldPath: string,
    readonly issue: string,
  ) {
    super('模型输出不符合结构化契约');
    this.name = 'SchemaValidationError';
  }
}

export function assertSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$',
) {
  const fail = (issue = 'TYPE', fieldPath = path) => {
    // Only paths formed from our trusted schema keys, never response values or
    // unknown provider keys, are available for diagnostics.
    throw new SchemaValidationError(fieldPath, issue);
  };
  if ('const' in schema && value !== schema.const) fail();
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail();
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    for (const key of (schema.required ?? []) as string[]) {
      if (!Object.hasOwn(object, key)) fail('MISSING_FIELD', `${path}.${key}`);
    }
    for (const [key, item] of Object.entries(object)) {
      if (!Object.hasOwn(properties, key)) {
        if (schema.additionalProperties === false) fail('EXTRA_FIELD');
      } else assertSchema(item, properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail();
    const array = value as unknown[];
    if (typeof schema.minItems === 'number' && array.length < schema.minItems)
      fail();
    if (typeof schema.maxItems === 'number' && array.length > schema.maxItems)
      fail();
    const prefix = (schema.prefixItems ?? []) as Record<string, unknown>[];
    array.forEach((item, index) => {
      const itemSchema = index < prefix.length ? prefix[index] : schema.items;
      if (itemSchema === false) fail();
      if (itemSchema && typeof itemSchema === 'object')
        assertSchema(
          item,
          itemSchema as Record<string, unknown>,
          `${path}[${index}]`,
        );
    });
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail();
    const text = value as string;
    if (
      typeof schema.minLength === 'number' &&
      Array.from(text).length < schema.minLength
    )
      fail();
    if (
      typeof schema.pattern === 'string' &&
      !new RegExp(schema.pattern).test(text)
    )
      fail();
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail();
  else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail();
    if (schema.type === 'integer' && !Number.isInteger(value)) fail();
    if (
      typeof schema.minimum === 'number' &&
      (value as number) < schema.minimum
    )
      fail();
  }
}
