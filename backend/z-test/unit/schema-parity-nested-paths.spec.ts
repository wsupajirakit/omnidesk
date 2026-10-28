describe('Schema Parity Nested Path Resolution', () => {
  it('correctly extracts root keys from nested schema paths (e.g., hmac.algorithm -> hmac)', () => {
    const mockSchemaPaths = {
      _id: {},
      name: {},
      'hmac.algorithm': {},
      'hmac.secret': {},
      'config.timeout_ms': {},
    };

    const schemaKeys = new Set<string>();
    for (const pathKey of Object.keys(mockSchemaPaths)) {
      schemaKeys.add(pathKey);
      const rootKey = pathKey.split('.')[0];
      if (rootKey) schemaKeys.add(rootKey);
    }
    schemaKeys.add('__v');

    expect(schemaKeys.has('hmac')).toBe(true);
    expect(schemaKeys.has('hmac.algorithm')).toBe(true);
    expect(schemaKeys.has('hmac.secret')).toBe(true);
    expect(schemaKeys.has('config')).toBe(true);
    expect(schemaKeys.has('name')).toBe(true);

    const documentKeys = ['_id', 'name', 'hmac', 'config'];
    const undeclared = documentKeys.filter((key) => !schemaKeys.has(key));
    expect(undeclared).toEqual([]);
  });
});
