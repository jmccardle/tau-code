/**
 * The JSON Schema a form is built from: a question's answer, a command's arguments, an
 * extension's options. τ renders these from Python types (`Literal`, `int`, a dataclass, `X | None`),
 * so the editors below cover what those produce; anything else is edited as JSON text, said so on
 * screen, and checked by the server (`Refused` comes back with τ's sentence).
 */

export type Schema = Record<string, unknown>;

/** The editor a schema gets. */
export type Editor =
  | { kind: 'choice'; options: unknown[] }
  | { kind: 'boolean' }
  | { kind: 'integer' }
  | { kind: 'number' }
  | { kind: 'string'; format: string | null }
  | { kind: 'object'; fields: { name: string; schema: Schema; required: boolean }[] }
  | { kind: 'optional'; inner: Schema }
  | { kind: 'json' };

/** `#/$defs/Name` (or `#/definitions/Name`) resolved against `root`, until no `$ref` is left. */
export function resolve(schema: Schema, root: Schema): Schema {
  let current = schema;
  for (let hops = 0; typeof current['$ref'] === 'string'; hops++) {
    if (hops > 32) throw new Error(`a $ref cycle at ${String(current['$ref'])}`);
    const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(current['$ref'] as string);
    const defs = match ? (root[match[1] as string] as Record<string, Schema> | undefined) : undefined;
    const target = match && defs ? defs[match[2] as string] : undefined;
    if (!target) throw new Error(`the schema names ${String(current['$ref'])}, which it does not define`);
    const { $ref: _ref, ...rest } = current;
    current = { ...target, ...rest };
  }
  return current;
}

function isNull(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && (schema as Schema)['type'] === 'null';
}

/** Which editor `schema` gets. */
export function editorOf(given: Schema, root: Schema): Editor {
  const schema = resolve(given, root);
  if (Array.isArray(schema['enum'])) return { kind: 'choice', options: schema['enum'] };
  if ('const' in schema) return { kind: 'choice', options: [schema['const']] };
  const union = (schema['anyOf'] ?? schema['oneOf']) as Schema[] | undefined;
  if (Array.isArray(union)) {
    const others = union.filter((member) => !isNull(member));
    if (others.length === 1 && others.length < union.length) return { kind: 'optional', inner: others[0] as Schema };
    const consts = union.map((member) => resolve(member, root));
    if (consts.every((member) => 'const' in member)) return { kind: 'choice', options: consts.map((m) => m['const']) };
    return { kind: 'json' };
  }
  const type = schema['type'];
  if (Array.isArray(type)) {
    const others = type.filter((name) => name !== 'null');
    if (others.length === 1 && others.length < type.length) return { kind: 'optional', inner: { ...schema, type: others[0] } };
    return { kind: 'json' };
  }
  switch (type) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'integer':
      return { kind: 'integer' };
    case 'number':
      return { kind: 'number' };
    case 'string':
      return { kind: 'string', format: typeof schema['format'] === 'string' ? (schema['format'] as string) : null };
    case 'object': {
      const properties = schema['properties'] as Record<string, Schema> | undefined;
      if (!properties) return { kind: 'json' };
      const required = new Set((schema['required'] as string[] | undefined) ?? []);
      return {
        kind: 'object',
        fields: Object.entries(properties).map(([name, field]) => ({ name, schema: field, required: required.has(name) })),
      };
    }
    default:
      return { kind: 'json' };
  }
}

/** The value a form starts with: the schema's `default`, an object's field defaults, or nothing. */
export function initial(given: Schema, root: Schema): unknown {
  const schema = resolve(given, root);
  if ('default' in schema) return schema['default'];
  const editor = editorOf(schema, root);
  if (editor.kind === 'object') {
    const value: Record<string, unknown> = {};
    for (const field of editor.fields) {
      const start = initial(field.schema, root);
      if (start !== undefined) value[field.name] = start;
    }
    return value;
  }
  if (editor.kind === 'boolean') return false;
  if (editor.kind === 'choice' && editor.options.length === 1) return editor.options[0];
  return undefined;
}

/** A short description of a schema's type, for a field's hint. */
export function typeHint(given: Schema, root: Schema): string {
  const editor = editorOf(given, root);
  switch (editor.kind) {
    case 'choice':
      return editor.options.map((option) => JSON.stringify(option)).join(' | ');
    case 'optional':
      return `${typeHint(editor.inner, root)} or none`;
    case 'string':
      return editor.format ?? 'text';
    case 'object':
      return 'object';
    case 'json':
      return 'JSON';
    default:
      return editor.kind;
  }
}
