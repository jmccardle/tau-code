#!/usr/bin/env node
/**
 * Generate packages/protocol/src/generated.ts from the installed τ's serve schema.
 *
 * This runs `tau serve --schema`, which prints the JSON Schema (2020-12) τ
 * renders from its own protocol dataclasses, and turns it into TypeScript. It
 * reads the τ a user actually runs -- not a path into a τ checkout -- so the
 * drift check below is a check against the daemon this client will dial.
 *
 * Usage:
 *   node scripts/generate-protocol.mjs
 *   TAU_BIN=/path/to/venv/bin/tau node scripts/generate-protocol.mjs
 *   node scripts/generate-protocol.mjs --check            # fail if the file is stale
 *   node scripts/generate-protocol.mjs --from FILE        # read a schema file instead
 *
 * `--from` is an explicit input, not a fallback: it exists for testing the
 * emitter against a schema τ has not shipped yet, and nothing reaches for it on
 * its own.
 *
 * Fail Early: the emitter handles exactly the JSON Schema keywords τ's schema
 * uses. Anything else THROWS, naming the path and the keyword. It never emits
 * `any` to get past a construct it does not understand -- a silent `any` is how
 * a protocol change reaches runtime instead of the build. The same goes for the
 * receiving half of the wire: a request with no `x-result`, or an event kind
 * with no `x-data`, is refused rather than typed `unknown`.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../packages/protocol/src/generated.ts');
const TAU_BIN = process.env['TAU_BIN'] ?? 'tau';
const CHECK_ONLY = process.argv.includes('--check');
const FROM = (() => {
  const index = process.argv.indexOf('--from');
  if (index === -1) return null;
  const path = process.argv[index + 1];
  if (!path) throw new Error('--from needs a schema file path.');
  return path;
})();

/** Keywords the emitter understands. Anything else is a hard error. */
const KNOWN_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'unevaluatedProperties',
  'anyOf',
  'oneOf',
  'allOf',
  '$ref',
  'enum',
  'const',
  'items',
  'description',
  'title',
  'default',
  'minimum',
  // A string's shape. TypeScript has no type for it, so it is a runtime claim
  // the daemon checks; it is read past, the way `minimum` is.
  'pattern',
  // τ's annotations: which result a request answers, which data an event kind carries.
  'x-result',
  'x-data',
]);

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
            `Set TAU_BIN to tau's console script (e.g. /path/to/venv/bin/tau).`,
        ),
      ),
    );
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(out);
      else
        reject(
          new Error(
            `'${bin} ${args.join(' ')}' exited ${code}. A τ older than serve protocol 0.2 has no ` +
              `--schema flag; tau-code needs one that does.\nstderr:\n${err}`,
          ),
        );
    });
  });
}

async function fetchSchema() {
  const text = FROM ? await readFile(FROM, 'utf8') : await run(TAU_BIN, ['serve', '--schema']);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`The schema did not parse as JSON: ${error}`);
  }
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
  return match[1];
}

function typeOf(schema, path, indent) {
  // Boolean schemas: `true` admits anything, `false` admits nothing. τ uses
  // `false` to forbid a property -- a finished entry has no `status` -- which
  // TypeScript says as `never`, so an object carrying it fails to narrow there.
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
  if (schema.allOf) {
    // `allOf` with an object sibling of its own (`required`, `properties`) is
    // an intersection with that object too; the frame unions use exactly this.
    const parts = schema.allOf.map((sub, i) => typeOf(sub, `${path}.allOf[${i}]`, indent));
    const { allOf: _ignored, ...rest } = schema;
    if (rest.properties) parts.push(objectType({ type: 'object', ...rest }, path, indent));
    return parts.map((part) => (part.includes('|') ? `(${part})` : part)).join(' & ');
  }

  const declared = schema.type;
  // `{}` is JSON Schema's "anything". It is said explicitly on the wire, so
  // `unknown` is the truthful translation, not a dodge.
  if (declared === undefined) {
    if (schema.properties || schema.required) return objectType(schema, path, indent);
    return 'unknown';
  }
  if (Array.isArray(declared)) {
    return declared.map((name) => typeOf({ ...schema, type: name }, path, indent)).join(' | ');
  }
  if (declared === 'object') return objectType(schema, path, indent);
  if (declared === 'array') {
    const items = schema.items;
    if (items === undefined) return 'unknown[]';
    const element = typeOf(items, `${path}.items`, indent);
    return /[|&]/.test(element) ? `(${element})[]` : `${element}[]`;
  }
  const scalar = SCALARS[declared];
  if (!scalar) throw new Error(`Unhandled type '${declared}' at ${path}.`);
  return scalar;
}

function union(members, path, indent) {
  return members.map((sub, i) => typeOf(sub, `${path}[${i}]`, indent)).join(' | ');
}

function objectType(schema, path, indent) {
  const properties = schema.properties ?? {};
  const names = Object.keys(properties);
  const extra = schema.additionalProperties;
  // `additionalProperties` absent or `{}` both mean "any other key"; a schema
  // means "other keys of this type".
  const closed = extra === false || schema.unevaluatedProperties === false;
  const open =
    !closed && (extra === undefined || extra === true || (typeof extra === 'object' && Object.keys(extra).length === 0));
  const typedExtra = typeof extra === 'object' && extra !== null && Object.keys(extra).length > 0;

  if (names.length === 0) {
    if (typedExtra) return `Record<string, ${typeOf(extra, `${path}.additionalProperties`, indent)}>`;
    return open ? 'Record<string, unknown>' : '{}';
  }

  const required = new Set(schema.required ?? []);
  const pad = '  '.repeat(indent + 1);
  const lines = [];
  for (const name of names) {
    const sub = properties[name];
    if (sub && sub.description) lines.push(`${pad}/** ${collapse(sub.description)} */`);
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
  const lines = wrap(collapse(text), 92);
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

/** The single string a def's `type` property pins, e.g. "submit" for Submit. */
function tagOf(def, name, field = 'type') {
  const property = def.properties?.[field];
  const values = property?.enum ?? ('const' in (property ?? {}) ? [property.const] : null);
  if (!values || values.length !== 1 || typeof values[0] !== 'string') {
    throw new Error(`$defs.${name}.${field} does not pin a single string; cannot tell which ${field} it is.`);
  }
  return values[0];
}

function required(schema, key) {
  if (!(key in schema)) {
    throw new Error(`The schema has no top-level '${key}'. This τ predates what tau-code generates from.`);
  }
  return schema[key];
}

function emit(schema) {
  const defs = required(schema, '$defs');
  const version = required(schema, 'x-protocol-version');
  const port = required(schema, 'x-default-port');

  // A request is a $def that says what it answers. Every ClientFrame member
  // must be one of them, by its `type` tag, so a request τ forgot to annotate
  // is caught here instead of typed as answering nothing.
  const requests = Object.entries(defs)
    .filter(([, def]) => 'x-result' in def)
    .map(([name, def]) => ({ name, type: tagOf(def, name), result: def['x-result'] }));
  const annotated = new Set(requests.map((request) => request.type));
  const frames = required(schema, 'ClientFrame').oneOf;
  if (!Array.isArray(frames)) throw new Error('ClientFrame is not a oneOf.');
  frames.forEach((frame, i) => {
    const target = frame.$ref ? defs[refName(frame.$ref, `ClientFrame.oneOf[${i}]`)] : frame;
    const pinned = (schema) => schema?.properties?.type?.const ?? schema?.properties?.type?.enum?.[0];
    const tag =
      pinned(target) ??
      target.allOf?.map((part) => part.$ref && pinned(defs[refName(part.$ref, 'ClientFrame')])).find(Boolean);
    if (!tag) throw new Error(`ClientFrame.oneOf[${i}] has no type tag.`);
    if (!annotated.has(tag)) {
      throw new Error(
        `The '${tag}' request has no x-result. Every request must say what it answers (null included); ` +
          `a request typed as answering 'unknown' is a hand-written claim waiting to happen.`,
      );
    }
  });

  const event = defs['Event'];
  if (!event) throw new Error('The schema has no $defs.Event.');
  const eventData = event['x-data'];
  if (!eventData || typeof eventData !== 'object') {
    throw new Error('$defs.Event has no x-data map; event payloads would be untyped.');
  }

  const out = [];
  out.push('/* eslint-disable */');
  out.push('/**');
  out.push(' * GENERATED FILE -- DO NOT EDIT.');
  out.push(' *');
  out.push(" * Regenerate with `npm run generate`, which reads `tau serve --schema` from the");
  out.push(" * installed τ. τ's protocol dataclasses are the source of truth; nothing here is");
  out.push(' * hand-maintained, and `npm run check:protocol` fails when this file is stale.');
  out.push(' *');
  out.push(` * ${collapse(schema.title ?? 'tau serve protocol')}`);
  out.push(' */');
  out.push('');
  out.push('/** The protocol version `hello` must name. */');
  out.push(`export const PROTOCOL_VERSION = ${JSON.stringify(version)} as const;`);
  out.push('/** The port `tau serve` listens on when its config names none. */');
  out.push(`export const DEFAULT_PORT = ${JSON.stringify(port)} as const;`);
  out.push('');

  for (const [name, def] of Object.entries(defs)) {
    out.push(...docComment(def.description));
    const rendered = typeOf(def, `$defs.${name}`, 0);
    const isPlainObject = rendered.startsWith('{') && !def.oneOf && !def.anyOf && !def.allOf;
    out.push(isPlainObject ? `export interface ${name} ${rendered}` : `export type ${name} = ${rendered};`);
    out.push('');
  }

  for (const frame of ['ClientFrame', 'ServerFrame']) {
    out.push(...docComment(schema[frame].description ?? `Every ${frame === 'ClientFrame' ? 'frame a client sends' : 'frame the daemon sends'}.`));
    out.push(`export type ${frame} = ${typeOf(schema[frame], frame, 0)};`);
    out.push('');
  }

  out.push('/** Every request, by its `type`. */');
  out.push('export interface Requests {');
  for (const request of requests) out.push(`  ${quoteKey(request.type)}: ${request.name};`);
  out.push('}');
  out.push('');
  out.push('/** What each request answers, by its `type`. */');
  out.push('export interface Results {');
  for (const request of requests) {
    out.push(`  ${quoteKey(request.type)}: ${typeOf(request.result, `$defs.${request.name}.x-result`, 1)};`);
  }
  out.push('}');
  out.push('');
  out.push('export type RequestType = keyof Requests;');
  out.push("export type RequestFields<T extends RequestType> = Omit<Requests[T], 'type'>;");
  out.push('');
  out.push('/** The `data` each event kind carries, by its `kind`. */');
  out.push('export interface EventData {');
  for (const [kind, data] of Object.entries(eventData)) {
    out.push(`  ${quoteKey(kind)}: ${typeOf(data, `$defs.Event.x-data.${kind}`, 1)};`);
  }
  out.push('}');
  out.push('');
  out.push('export type EventKind = keyof EventData;');
  out.push('');
  out.push('/** Every request type, in the schema\'s order. */');
  out.push(`export const REQUEST_TYPES = ${JSON.stringify(requests.map((r) => r.type))} as const;`);
  out.push('/** Every event kind, in the schema\'s order. */');
  out.push(`export const EVENT_KINDS = ${JSON.stringify(Object.keys(eventData))} as const;`);
  out.push('');

  return { source: out.join('\n'), version, requests: requests.length, kinds: Object.keys(eventData).length };
}

const schema = await fetchSchema();
const { source, version, requests, kinds } = emit(schema);

if (CHECK_ONLY) {
  const existing = await readFile(OUT, 'utf8').catch(() => null);
  if (existing !== source) {
    console.error(
      `generated.ts is stale. τ speaks serve protocol ${version}; run 'npm run generate' and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`generated.ts matches τ serve protocol ${version}.`);
} else {
  await writeFile(OUT, source, 'utf8');
  console.log(`Wrote ${OUT}\n  serve protocol ${version}: ${requests} requests, ${kinds} event kinds.`);
}
