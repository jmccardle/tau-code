#!/usr/bin/env node
/**
 * Generate packages/protocol/src/generated.ts from a live tau process.
 *
 * This spawns `tau --mode rpc --no-session`, sends one `get_capabilities`
 * request, and turns the answer into TypeScript. It uses only the documented
 * wire, so it needs no Python import, no access to the tau source tree, and no
 * script committed on tau's side. `get_capabilities` returns every command with
 * its `params_schema` and `result_schema`, plus `event_schema`, `declined`,
 * `limits`, and `protocol_version` -- about 68 KiB.
 *
 * Usage:
 *   node scripts/generate-protocol.mjs
 *   TAU_BIN=/path/to/venv/bin/tau node scripts/generate-protocol.mjs
 *   node scripts/generate-protocol.mjs --check    # fail if the file is stale
 *
 * Fail Early: the emitter below handles exactly the JSON Schema keywords tau
 * actually uses. Anything else THROWS, naming the path and the keyword. It
 * never emits `any` to get past a construct it does not understand -- a silent
 * `any` is how a protocol change reaches runtime instead of the build.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../packages/protocol/src/generated.ts');
const TAU_BIN = process.env['TAU_BIN'] ?? 'tau';
const CHECK_ONLY = process.argv.includes('--check');

/** Keywords the emitter understands. Anything else is a hard error. */
const KNOWN_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'anyOf',
  'enum',
  'description',
  'title',
  'default',
  'minimum',
]);

const SCALARS = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
  null: 'null',
  // tau's schemas never give `items`, so an array's element type is genuinely
  // unspecified on the wire. `unknown[]` says that; `any[]` would pretend
  // otherwise and let a consumer index into it unchecked.
  array: 'unknown[]',
};

function fetchCapabilities() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(TAU_BIN, ['--mode', 'rpc', '--no-session'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const index = out.indexOf('\n');
      if (index !== -1) {
        const line = out.slice(0, index);
        child.kill();
        try {
          const message = JSON.parse(line);
          if (message.error) {
            reject(new Error(`tau answered get_capabilities with an error: ${line}`));
            return;
          }
          resolvePromise(message.result);
        } catch (error) {
          reject(new Error(`tau's first line did not parse as JSON: ${line}\n${error}`));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', (error) => {
      reject(
        new Error(
          `Could not run '${TAU_BIN}': ${error.message}\n` +
            `Set TAU_BIN to tau's console script (e.g. /path/to/venv/bin/tau).`,
        ),
      );
    });
    child.on('exit', (code) => {
      if (out.indexOf('\n') === -1) {
        reject(new Error(`tau exited (${code}) without answering. stderr:\n${err}`));
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_capabilities' }) + '\n');
  });
}

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

function typeOf(schema, path, indent) {
  if (typeof schema !== 'object' || schema === null) {
    throw new Error(`Schema at ${path} is not an object.`);
  }
  checkKeywords(schema, path);

  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  }
  if (schema.anyOf) {
    return schema.anyOf.map((sub, i) => typeOf(sub, `${path}.anyOf[${i}]`, indent)).join(' | ');
  }

  const declared = schema.type;
  if (declared === undefined) return 'unknown';

  if (Array.isArray(declared)) {
    return declared
      .map((name) => {
        if (name === 'object') return objectType(schema, path, indent);
        const scalar = SCALARS[name];
        if (!scalar) throw new Error(`Unhandled type '${name}' at ${path}.`);
        return scalar;
      })
      .join(' | ');
  }

  if (declared === 'object') return objectType(schema, path, indent);
  const scalar = SCALARS[declared];
  if (!scalar) throw new Error(`Unhandled type '${declared}' at ${path}.`);
  return scalar;
}

function objectType(schema, path, indent) {
  const properties = schema.properties ?? {};
  const names = Object.keys(properties);
  const open = schema.additionalProperties !== false;

  if (names.length === 0) {
    return open ? 'Record<string, unknown>' : '{}';
  }

  const required = new Set(schema.required ?? []);
  const pad = '  '.repeat(indent + 1);
  const lines = [];
  for (const name of names) {
    const sub = properties[name];
    const rendered = typeOf(sub, `${path}.${name}`, indent + 1);
    if (sub.description) {
      lines.push(`${pad}/** ${collapse(sub.description)} */`);
    }
    const optional = required.has(name) ? '' : '?';
    lines.push(`${pad}${quoteKey(name)}${optional}: ${rendered};`);
  }
  if (open) {
    // A client MUST ignore any field it does not recognize: MINOR bumps are
    // additive, so an unknown key is expected, not a violation.
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

function pascal(name) {
  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function emit(caps) {
  const commands = [...caps.commands].sort((a, b) => a.name.localeCompare(b.name));
  const out = [];

  out.push('/* eslint-disable */');
  out.push('/**');
  out.push(' * GENERATED FILE -- DO NOT EDIT.');
  out.push(' *');
  out.push(' * Regenerate with `npm run generate`, which spawns a real tau process and');
  out.push(' * reads `get_capabilities`. The wire is the source of truth; nothing here is');
  out.push(' * hand-maintained.');
  out.push(' *');
  out.push(` * Protocol version: ${caps.protocol_version}   Dialect: ${caps.dialect}`);
  out.push(` * Commands: ${caps.commands.length}   Declined: ${caps.declined.length}   Events: ${caps.events.length}`);
  out.push(' */');
  out.push('');
  out.push(`/** The protocol version this file was generated from. */`);
  out.push(`export const PROTOCOL_VERSION = ${JSON.stringify(caps.protocol_version)} as const;`);
  out.push(`export const DIALECT = ${JSON.stringify(caps.dialect)} as const;`);
  out.push('');
  out.push('/** Bounds tau enforces on what a host may SEND. */');
  out.push(`export const LIMITS = ${JSON.stringify(caps.limits, null, 2)} as const;`);
  out.push('');
  out.push('/** The ten agent lifecycle event types. */');
  out.push(
    `export const EVENT_TYPES = [\n${caps.events.map((e) => `  ${JSON.stringify(e)},`).join('\n')}\n] as const;`,
  );
  out.push('export type EventType = (typeof EVENT_TYPES)[number];');
  out.push('');
  out.push('/** Verbs tau deliberately does not implement, with its stated reason. */');
  out.push('export const DECLINED: Readonly<Record<string, string>> = {');
  for (const entry of [...caps.declined].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`  ${quoteKey(entry.name)}: ${JSON.stringify(collapse(entry.reason))},`);
  }
  out.push('};');
  out.push('');

  if (caps.event_schema.description) {
    out.push(`/** ${collapse(caps.event_schema.description)} */`);
  }
  out.push(`export interface WireEvent ${typeOf(caps.event_schema, 'event_schema', 0)}`);
  out.push('');

  for (const command of commands) {
    const name = pascal(command.name);
    out.push(`/**`);
    out.push(` * \`${command.name}\` (tier ${command.tier}, since ${command.since}).`);
    out.push(` *`);
    for (const line of wrap(collapse(command.notes), 92)) out.push(` * ${line}`);
    out.push(` */`);
    out.push(`export type ${name}Params = ${typeOf(command.params_schema, `${command.name}.params`, 0)};`);
    out.push(`export type ${name}Result = ${typeOf(command.result_schema, `${command.name}.result`, 0)};`);
    out.push('');
  }

  out.push('/** Every verb on the wire, mapped to its params and result. */');
  out.push('export interface Commands {');
  for (const command of commands) {
    const name = pascal(command.name);
    out.push(`  ${quoteKey(command.name)}: { params: ${name}Params; result: ${name}Result };`);
  }
  out.push('}');
  out.push('');
  out.push('export type CommandName = keyof Commands;');
  out.push('export type CommandParams<M extends CommandName> = Commands[M]["params"];');
  out.push('export type CommandResult<M extends CommandName> = Commands[M]["result"];');
  out.push('');
  out.push('/** The tier each verb belongs to, for a host that surfaces the distinction. */');
  out.push('export const COMMAND_TIERS: Readonly<Record<CommandName, "A" | "B" | "C">> = {');
  for (const command of commands) {
    out.push(`  ${quoteKey(command.name)}: ${JSON.stringify(command.tier)},`);
  }
  out.push('};');
  out.push('');
  out.push('/**');
  out.push(' * The full `get_capabilities` result, exactly as the wire declares it.');
  out.push(' *');
  out.push(' * Its array fields are `unknown[]` because tau\'s schemas carry no `items`.');
  out.push(' * That is not a gap in this generator -- it is what the wire says. Element');
  out.push(' * shapes are asserted in hand-written code (`capabilities.ts`), where the');
  out.push(' * assertion is visible and checked, rather than invented here.');
  out.push(' */');
  out.push('export type Capabilities = GetCapabilitiesResult;');
  out.push('');

  return out.join('\n');
}

function wrap(text, width) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const caps = await fetchCapabilities();
const source = emit(caps);

if (CHECK_ONLY) {
  const existing = await readFile(OUT, 'utf8').catch(() => null);
  if (existing !== source) {
    console.error(
      `generated.ts is stale. tau speaks protocol ${caps.protocol_version}; ` +
        `run 'npm run generate' and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`generated.ts matches tau protocol ${caps.protocol_version}.`);
} else {
  await writeFile(OUT, source, 'utf8');
  console.log(
    `Wrote ${OUT}\n  protocol ${caps.protocol_version}, ` +
      `${caps.commands.length} commands, ${caps.declined.length} declined, ${caps.events.length} events.`,
  );
}
