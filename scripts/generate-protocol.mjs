#!/usr/bin/env node
/**
 * Generate packages/protocol/src/generated.ts from τ's wire schema (protocol 3, τ ≥ 0.18).
 *
 * The input is pinned: packages/protocol/schema/protocol.schema.json, a copy of what
 * `tau serve --schema` prints. The build reads only that file, so building tau-code needs no τ;
 * `--check` is what holds the copy to the τ you run.
 *
 * Usage:
 *   node scripts/generate-protocol.mjs              # fetch the schema from τ, pin it, generate
 *   node scripts/generate-protocol.mjs --from FILE  # pin FILE instead of asking τ, generate
 *   node scripts/generate-protocol.mjs --check      # fail if the pin differs from τ's schema,
 *                                                   # or generated.ts differs from the pin
 *
 * τ is `$TAU_BIN`, or `tau` on PATH. `--from` is an explicit input, never a fallback.
 *
 * Fail Early: the emitter handles exactly the JSON Schema keywords τ's schema uses. Anything else
 * THROWS, naming the path and the keyword; it never emits `any` to get past a construct it does
 * not understand. τ's own keywords are accepted only where τ puts them:
 *   - `x-protocol` (top level): the protocol number `hello` names;
 *   - `x-result` (on a method's params definition): what the method answers;
 *   - `x-names` / `x-raises` (on an integer enum): each member's name, and the Python exception
 *     `RemoteClient` raises for it (the error table).
 * Events are tagged by `kind` (a `const`); core values are serde's external tagging (a bare
 * string for a unit variant, a closed one-key object otherwise), which plain `oneOf`, `enum` and
 * `additionalProperties: false` already say.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../packages/protocol/src/generated.ts');
const PIN = resolve(HERE, '../packages/protocol/schema/protocol.schema.json');
const TAU_BIN = process.env['TAU_BIN'] ?? 'tau';
const CHECK_ONLY = process.argv.includes('--check');
const FROM = (() => {
  const index = process.argv.indexOf('--from');
  if (index === -1) return null;
  const path = process.argv[index + 1];
  if (!path) throw new Error('--from needs a schema file path.');
  return path;
})();

/** Keywords a schema node may carry. Anything else is a hard error. */
const KNOWN_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'anyOf',
  'oneOf',
  '$ref',
  'enum',
  'const',
  'items',
  // A fixed-length array, `(extension, text)`: a tuple, with `minItems`/`maxItems` equal to its
  // length. A plain array may carry `maxItems` alone (see arrayType); TypeScript has no type for it.
  'prefixItems',
  'minItems',
  'maxItems',
  'description',
  'title',
  'default',
  // Runtime claims τ checks (`minimum: 0`, `format: uint64`); TypeScript has no type for them.
  'minimum',
  'format',
]);

/** The top level of τ's schema. */
const TOP_KEYS = new Set(['$schema', 'title', 'description', 'x-protocol', '$defs']);

const SCALARS = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
};

function run(bin, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) =>
      reject(
        new Error(
          `Could not run '${bin}': ${error.message}\n` +
            `Set TAU_BIN to τ's console script (e.g. /path/to/venv/bin/tau).`,
        ),
      ),
    );
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(out);
      else reject(new Error(`'${bin} ${args.join(' ')}' exited ${code}.\nstderr:\n${err}`));
    });
  });
}

function parse(text, where) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${where} did not parse as JSON: ${error}`);
  }
}

/** The schema text as pinned: two-space JSON and a final newline, so a diff of the pin reads. */
function pinned(schema) {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

// ── the emitter ─────────────────────────────────────────────────────────────

function checkKeywords(schema, path) {
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(key)) {
      throw new Error(
        `Unhandled JSON Schema keyword '${key}' at ${path}. ` +
          `The emitter in scripts/generate-protocol.mjs must learn it before this can regenerate. ` +
          `Refusing to emit a type that would silently ignore it.`,
      );
    }
  }
}

function refName(ref, path) {
  const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!match) throw new Error(`Unhandled $ref '${ref}' at ${path}: only #/$defs/<Name> is understood.`);
  return typeName(match[1]);
}

/** A definition's TypeScript name: a method's params are `<Method>Params`. */
let METHOD_NAMES = new Set();
function typeName(def) {
  return METHOD_NAMES.has(def) ? `${pascal(def)}Params` : def;
}

function pascal(snake) {
  return snake
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function upperSnake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

function typeOf(schema, path, indent) {
  if (schema === true) return 'unknown';
  if (schema === false) return 'never';
  if (typeof schema !== 'object' || schema === null) {
    throw new Error(`Schema at ${path} is not an object.`);
  }
  checkKeywords(schema, path);

  if (schema.$ref) return refName(schema.$ref, path);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.anyOf) return union(schema.anyOf, `${path}.anyOf`, indent);
  if (schema.oneOf) return union(schema.oneOf, `${path}.oneOf`, indent);

  const declared = schema.type;
  // `{}` is JSON Schema's "anything": the wire says so explicitly (`answer`'s value), so
  // `unknown` is the truthful translation, not a dodge.
  if (declared === undefined) {
    if (schema.properties || schema.required) return objectType(schema, path, indent);
    if (Object.keys(schema).every((key) => key === 'description' || key === 'title')) return 'unknown';
    throw new Error(`Schema at ${path} has no type and is not an object or "anything".`);
  }
  if (Array.isArray(declared)) {
    return declared.map((name) => typeOf({ ...schema, type: name }, path, indent)).join(' | ');
  }
  if (declared === 'object') return objectType(schema, path, indent);
  if (declared === 'array') return arrayType(schema, path, indent);
  if ('prefixItems' in schema || 'minItems' in schema || 'maxItems' in schema) {
    throw new Error(`${path}: prefixItems/minItems/maxItems on a ${declared}.`);
  }
  const scalar = SCALARS[declared];
  if (!scalar) throw new Error(`Unhandled type '${declared}' at ${path}.`);
  return scalar;
}

function arrayType(schema, path, indent) {
  if (schema.prefixItems) {
    const length = schema.prefixItems.length;
    if (schema.items !== undefined || schema.minItems !== length || schema.maxItems !== length) {
      throw new Error(
        `${path}: a prefixItems array is emitted only as a tuple, with minItems = maxItems = ` +
          `${length} and no items; this one is something else.`,
      );
    }
    const members = schema.prefixItems.map((sub, i) => typeOf(sub, `${path}.prefixItems[${i}]`, indent));
    return `[${members.join(', ')}]`;
  }
  // A plain array may carry `maxItems` (protocol 3: `images` on `input`/`send`, at most 20): a
  // runtime claim τ checks, like `minimum`; TypeScript has no type for it. `minItems` has no use
  // in τ's schema yet, so it is still refused rather than silently dropped.
  if ('minItems' in schema) {
    throw new Error(`${path}: minItems without prefixItems has no TypeScript type.`);
  }
  if ('maxItems' in schema && !(Number.isInteger(schema.maxItems) && schema.maxItems >= 0)) {
    throw new Error(`${path}: maxItems must be a non-negative integer, not ${JSON.stringify(schema.maxItems)}.`);
  }
  if (schema.items === undefined) return 'unknown[]';
  const element = typeOf(schema.items, `${path}.items`, indent);
  return /[|&]/.test(element) ? `(${element})[]` : `${element}[]`;
}

function union(members, path, indent) {
  return members.map((sub, i) => typeOf(sub, `${path}[${i}]`, indent)).join(' | ');
}

function objectType(schema, path, indent) {
  const properties = schema.properties ?? {};
  const names = Object.keys(properties);
  const extra = schema.additionalProperties;
  // `additionalProperties` absent or `true` means "any other key"; `false` closes the object (a
  // serde variant, a method's params); a schema means "other keys of this type".
  const closed = extra === false;
  const open = extra === undefined || extra === true;
  const typedExtra = typeof extra === 'object' && extra !== null;

  if (names.length === 0) {
    if (typedExtra) return `Record<string, ${typeOf(extra, `${path}.additionalProperties`, indent)}>`;
    return closed ? 'Record<string, never>' : 'Record<string, unknown>';
  }

  const required = new Set(schema.required ?? []);
  for (const name of required) {
    if (!(name in properties)) throw new Error(`${path}: required '${name}' is not a property.`);
  }
  const pad = '  '.repeat(indent + 1);
  const lines = [];
  for (const name of names) {
    const sub = properties[name];
    if (sub && sub.description) lines.push(...docComment(sub.description, pad));
    const optional = required.has(name) ? '' : '?';
    lines.push(`${pad}${quoteKey(name)}${optional}: ${typeOf(sub, `${path}.${name}`, indent + 1)};`);
  }
  if (typedExtra) {
    lines.push(`${pad}[key: string]: ${typeOf(extra, `${path}.additionalProperties`, indent + 1)} | undefined;`);
  } else if (open) {
    lines.push(`${pad}[key: string]: unknown;`);
  }
  return `{\n${lines.join('\n')}\n${'  '.repeat(indent)}}`;
}

function quoteKey(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function collapse(text) {
  return String(text).replace(/\s+/g, ' ').replace(/\*\//g, '*\\/').trim();
}

function docComment(text, indent = '') {
  if (!text) return [];
  const lines = wrap(collapse(text), 96 - indent.length);
  if (lines.length === 1) return [`${indent}/** ${lines[0]} */`];
  return [`${indent}/**`, ...lines.map((line) => `${indent} * ${line}`), `${indent} */`];
}

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ── reading the schema's structure ──────────────────────────────────────────

function need(object, key, where) {
  if (!(key in object)) throw new Error(`${where} has no '${key}'. This is not τ's wire schema.`);
  return object[key];
}

/** The `kind` a definition pins, e.g. `"CursorView"`. */
function kindOf(defs, ref, path) {
  const name = refName(ref, path);
  const kind = defs[name]?.properties?.kind?.const;
  if (typeof kind !== 'string') throw new Error(`${path}: $defs.${name} pins no 'kind' const.`);
  if (kind !== name) throw new Error(`${path}: $defs.${name} pins kind '${kind}', not its own name.`);
  if (!defs[name].required?.includes('kind')) throw new Error(`${path}: $defs.${name} does not require 'kind'.`);
  return kind;
}

/** Each member of a union of `$ref`s, by its `kind`. */
function kinds(defs, union, path) {
  if (!Array.isArray(union)) throw new Error(`${path} is not a union.`);
  return union.map((member, i) => {
    if (!member.$ref || Object.keys(member).length !== 1) throw new Error(`${path}[${i}] is not a bare $ref.`);
    return kindOf(defs, member.$ref, `${path}[${i}]`);
  });
}

function emit(schema) {
  for (const key of Object.keys(schema)) {
    if (!TOP_KEYS.has(key)) {
      throw new Error(`Unhandled top-level key '${key}' in the schema; the emitter must learn it first.`);
    }
  }
  const protocol = need(schema, 'x-protocol', 'The schema');
  if (!Number.isInteger(protocol)) throw new Error(`x-protocol is ${JSON.stringify(protocol)}, not an integer.`);
  const defs = need(schema, '$defs', 'The schema');

  // A method is a definition that says what it answers: its params, then `x-result`.
  const methods = Object.entries(defs)
    .filter(([, def]) => 'x-result' in def)
    .map(([name]) => name);
  for (const name of methods) {
    if (!/^[a-z][a-z_]*$/.test(name)) throw new Error(`$defs.${name} has x-result but is not a method name.`);
    if (defs[name].type !== 'object') throw new Error(`The params of '${name}' are not an object.`);
  }
  if (!methods.includes('hello')) throw new Error('The schema has no hello method.');
  METHOD_NAMES = new Set(methods);

  // The two notifications a server sends: `event` (one of the kinds) and `end`.
  const event = need(defs, 'Event', '$defs');
  const eventKinds = kinds(defs, event.oneOf, '$defs.Event.oneOf');
  need(defs, 'End', '$defs');
  const live = need(defs, 'Live', '$defs');
  const deltaKinds = kinds(defs, live.properties?.delta?.anyOf, '$defs.Live.properties.delta.anyOf');

  const out = [];
  out.push('/* eslint-disable */');
  out.push('/**');
  out.push(' * GENERATED FILE -- DO NOT EDIT.');
  out.push(' *');
  out.push(' * From packages/protocol/schema/protocol.schema.json, the pinned copy of `tau serve --schema`.');
  out.push(' * Regenerate with `npm run generate`; `npm run check:protocol` fails when either is stale.');
  out.push(' *');
  out.push(` * ${collapse(schema.title ?? 'τ wire protocol')}: ${collapse(schema.description ?? '')}`);
  out.push(' */');
  out.push('');
  out.push('/** The protocol `hello` names. The server refuses any other number (`ProtocolMismatch`). */');
  out.push(`export const PROTOCOL = ${protocol} as const;`);
  out.push('');

  const named = [];
  for (const [name, original] of Object.entries(defs)) {
    let def = original;
    if (METHOD_NAMES.has(name)) {
      const { 'x-result': result, ...params } = def;
      out.push(...docComment(params.description));
      const rendered = typeOf(params, `$defs.${name}`, 0);
      out.push(
        rendered.startsWith('{')
          ? `export interface ${pascal(name)}Params ${rendered}`
          : `export type ${pascal(name)}Params = ${rendered};`,
      );
      out.push(...docComment(`What \`${name}\` answers.`));
      out.push(`export type ${pascal(name)}Result = ${typeOf(result, `$defs.${name}.x-result`, 0)};`);
      out.push('');
      continue;
    }
    if ('x-names' in def || 'x-raises' in def) {
      const { 'x-names': names, 'x-raises': raises, ...rest } = def;
      if (!Array.isArray(rest.enum) || !Array.isArray(names) || names.length !== rest.enum.length) {
        throw new Error(`$defs.${name}: x-names must name each member of its enum, in order.`);
      }
      if (raises !== undefined && (!Array.isArray(raises) || raises.length !== rest.enum.length)) {
        throw new Error(`$defs.${name}: x-raises must have one entry per member of its enum.`);
      }
      named.push({ name, values: rest.enum, names, raises });
      def = rest;
    }
    out.push(...docComment(def.description));
    const rendered = typeOf(def, `$defs.${name}`, 0);
    const isPlainObject = rendered.startsWith('{') && !def.oneOf && !def.anyOf;
    out.push(isPlainObject ? `export interface ${name} ${rendered}` : `export type ${name} = ${rendered};`);
    out.push('');
  }

  out.push('/** Every method\'s params, by its name. */');
  out.push('export interface Requests {');
  for (const method of methods) out.push(`  ${method}: ${pascal(method)}Params;`);
  out.push('}');
  out.push('');
  out.push('/** What each method answers, by its name. */');
  out.push('export interface Results {');
  for (const method of methods) out.push(`  ${method}: ${pascal(method)}Result;`);
  out.push('}');
  out.push('');
  out.push('export type Method = keyof Requests;');
  out.push('');
  out.push('/** A `Live` event\'s `delta`. */');
  out.push(`export type Delta = ${deltaKinds.join(' | ')};`);
  out.push('');
  out.push('/** Every method, in the schema\'s order. */');
  out.push(`export const METHODS = ${JSON.stringify(methods)} as const;`);
  out.push('/** Every event `kind`, in the schema\'s order. */');
  out.push(`export const EVENT_KINDS = ${JSON.stringify(eventKinds)} as const;`);
  out.push('/** Every delta `kind`, in the schema\'s order. */');
  out.push(`export const DELTA_KINDS = ${JSON.stringify(deltaKinds)} as const;`);
  for (const { name, values, names, raises } of named) {
    const constant = upperSnake(name);
    out.push('');
    out.push(`/** Each \`${name}\` by its name (\`x-names\`). */`);
    out.push(`export const ${constant}S = {`);
    names.forEach((member, i) => out.push(`  ${quoteKey(member)}: ${JSON.stringify(values[i])},`));
    out.push('} as const;');
    if (raises) {
      out.push(`/** The Python exception τ's \`RemoteClient\` raises for each \`${name}\` (\`x-raises\`). */`);
      out.push(`export const ${constant}_RAISES = {`);
      names.forEach((member, i) => out.push(`  ${quoteKey(member)}: ${JSON.stringify(raises[i])},`));
      out.push('} as const;');
    }
  }
  out.push('');

  return {
    source: out.join('\n'),
    protocol,
    methods: methods.length,
    events: eventKinds.length,
    deltas: deltaKinds.length,
  };
}

async function main() {
  if (CHECK_ONLY) {
    const pin = await readFile(PIN, 'utf8');
    const { source, protocol } = emit(parse(pin, PIN));
    const existing = await readFile(OUT, 'utf8').catch(() => null);
    const problems = [];
    if (existing !== source) problems.push(`generated.ts is stale against the pinned schema.`);
    const live = await run(TAU_BIN, ['serve', '--schema']);
    if (pinned(parse(live, `'${TAU_BIN} serve --schema'`)) !== pin) {
      problems.push(`the pinned schema differs from '${TAU_BIN} serve --schema'.`);
    }
    if (problems.length) {
      console.error(`${problems.join('\n')}\nRun 'npm run generate' (TAU_BIN=${TAU_BIN}) and commit the result.`);
      process.exit(1);
    }
    console.log(`generated.ts and the pinned schema match ${TAU_BIN}: protocol ${protocol}.`);
    return;
  }
  const text = FROM ? await readFile(FROM, 'utf8') : await run(TAU_BIN, ['serve', '--schema']);
  const schema = parse(text, FROM ?? `'${TAU_BIN} serve --schema'`);
  const { source, protocol, methods, events, deltas } = emit(schema);
  await writeFile(PIN, pinned(schema), 'utf8');
  await writeFile(OUT, source, 'utf8');
  console.log(
    `Wrote ${PIN}\nWrote ${OUT}\n  protocol ${protocol}: ${methods} methods, ${events} event kinds, ${deltas} delta kinds.`,
  );
}

await main();
