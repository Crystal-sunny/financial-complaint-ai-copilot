type Schema = Record<string, unknown>;

// JSON mode is not strict schema mode. Select only declared fields before
// validation; never supply defaults, coerce types, or edit business values.
// Omitted keys/values are neither returned nor logged, only their count.
export function projectSchemaFields(value: unknown, schema: Schema) {
  let omittedFieldCount = 0;
  function visit(input: unknown, contract: Schema): unknown {
    if (contract.type === 'array' && Array.isArray(input)) {
      const prefix = (contract.prefixItems ?? []) as Schema[];
      return input.map((item, index) => {
        const child = index < prefix.length ? prefix[index] : contract.items;
        return child && typeof child === 'object'
          ? visit(item, child as Schema)
          : item;
      });
    }
    if (
      contract.type !== 'object' ||
      input === null ||
      typeof input !== 'object' ||
      Array.isArray(input)
    )
      return input;
    const properties = (contract.properties ?? {}) as Record<string, Schema>;
    const entries: [string, unknown][] = [];
    for (const [key, item] of Object.entries(input)) {
      if (Object.hasOwn(properties, key))
        entries.push([key, visit(item, properties[key])]);
      else if (contract.additionalProperties === false) omittedFieldCount++;
      else entries.push([key, item]);
    }
    return Object.fromEntries(entries);
  }
  const output = visit(value, schema);
  return { output, omittedFieldCount };
}
