/**
 * The pure parts of the views: transcript rows, tree lines, the command-line plan, completion, and
 * the schema editors. The React components over them are exercised in a real browser by
 * `npm run smoke:browser`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionModel, ServeError } from '@ffwf/tau-code-protocol';
import { complete, editorOf, initial, planLine, qualified, rows, treeLines } from '../dist/index.js';

const node = (id, parent, body, by = { Frontend: 'me' }, extra = {}) => ({ id, parent, time: 0, by, body, delivers: [], ...extra });

test('a walk becomes rows: parts, calls, results, a stop that was not the end', () => {
  const walk = [
    node(0, null, { System: 'be brief' }, 'Core'),
    node(1, 0, { User: 'list files @a.txt' }, { Frontend: 'me' }, { typed: 'list files' }),
    node(
      2,
      1,
      {
        Assistant: {
          parts: [{ Thinking: 'hmm' }, { Text: { text: 'Sure.', replay: { data: '{}', provider: 'p' } } }, { Call: { id: 'c0', tool: 'bash', args_raw: '{"cmd":"ls"}' } }],
          stop: 'Tools',
        },
      },
      'Provider',
    ),
    node(3, 2, { Results: [['c0', { Err: 'no such file' }, 'Tools']] }, 'Tools'),
    node(4, 3, { Assistant: { parts: [{ Text: 'cut' }], stop: 'Length', finish_reason: 'length' } }, 'Provider'),
    node(5, 4, { User: 'from another' }, { Frontend: 'them' }),
  ];
  const shown = rows(walk, 'me').map((r) => [r.kind, r.text, r.mine, r.label ?? null, r.ok ?? null]);
  assert.deepEqual(shown, [
    ['system', 'be brief', false, null, null],
    ['user', 'list files', true, null, null],
    ['thinking', 'hmm', false, null, null],
    ['assistant', 'Sure.', false, null, null],
    ['call', '{\n  "cmd": "ls"\n}', false, 'bash', null],
    ['result', 'no such file', false, 'c0', false],
    ['assistant', 'cut', false, null, null],
    ['stop', 'the reply stopped: Length (length)', false, null, null],
    ['user', 'from another', false, null, null],
  ]);
});

test('tree lines: the first child continues the line, the others branch one deeper', () => {
  const model = new SessionModel();
  model.insert([
    node(0, null, { System: 's' }, 'Core'),
    node(1, 0, { User: 'a' }),
    node(2, 1, { User: 'b' }),
    node(3, 1, { User: 'c (a branch)' }),
    node(4, 2, { User: 'd' }),
    node(5, 3, { User: 'e' }),
  ]);
  assert.deepEqual(
    treeLines(model).map((line) => [line.node.id, line.depth, line.children]),
    [
      [0, 0, 1],
      [1, 0, 2],
      [2, 0, 1],
      [4, 0, 0],
      [3, 1, 1],
      [5, 1, 0],
    ],
  );
});

/** A fake `call`: answers by method from `answers`, recording what was asked. */
function fake(answers) {
  const asked = [];
  const call = async (method, params) => {
    asked.push([method, params]);
    const answer = answers[method];
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(params) : answer;
  };
  return { call, asked };
}

const form = (name, extension = null) => ({ name, description: 'd', schema: { type: 'object', properties: {} }, extension });

test('plain text is sent; a line naming no command is sent too, as τ says', async () => {
  assert.deepEqual(await planLine(fake({}).call, 0, 'hello'), { kind: 'send', text: 'hello' });
  const unknown = new ServeError('parse_line', { code: -32008, message: 'no command /etc', data: { name: 'etc' } });
  assert.deepEqual(await planLine(fake({ parse_line: unknown }).call, 0, '/etc/hosts?'), {
    kind: 'send',
    text: '/etc/hosts?',
  });
});

test('a whole command runs by its qualified name; a short one asks; a refusal is thrown', async () => {
  const whole = fake({ parse_line: { command: form('note', 'a'), args: { text: 'x' }, missing: [] } });
  assert.deepEqual(await planLine(whole.call, 2, '/a:note x'), { kind: 'run', command: 'a:note', args: { text: 'x' } });
  assert.deepEqual(whole.asked, [['parse_line', { cursor: 2, line: '/a:note x' }]]);

  const short = fake({ parse_line: { command: form('flood', 'flood'), args: { count: 2 }, missing: ['text'] } });
  const plan = await planLine(short.call, 0, '/flood 2');
  assert.equal(plan.kind, 'ask');
  assert.deepEqual(plan.missing, ['text']);

  const refused = new ServeError('parse_line', { code: -32009, message: 'count: not an integer' });
  await assert.rejects(planLine(fake({ parse_line: refused }).call, 0, '/flood x'), /not an integer/);
  assert.equal(qualified(form('model')), 'model');
});

test('/config <extension> shows its options; with values it configures', async () => {
  const options = { name: 'tuner', description: 'tuner options', schema: { type: 'object', properties: {} } };
  const bare = fake({ parse_line: { command: options, args: {}, missing: [], extension: 'tuner', save: true }, options });
  assert.deepEqual(await planLine(bare.call, 0, '/config tuner --save'), { kind: 'options', extension: 'tuner', form: options, save: true });
  assert.deepEqual(bare.asked[1], ['options', { cursor: 0, extension: 'tuner' }]);

  const set = fake({ parse_line: { command: options, args: { depth: 3 }, missing: [], extension: 'tuner' } });
  assert.deepEqual(await planLine(set.call, 0, '/config tuner depth=3'), {
    kind: 'configure',
    extension: 'tuner',
    values: { depth: 3 },
    save: false,
  });
});

test('a completion replaces the word being typed, quotes and all', () => {
  assert.equal(complete('/mo', '/model'), '/model');
  assert.equal(complete('/model qw', 'qwen'), '/model qwen');
  assert.equal(complete('/model ', 'qwen'), '/model qwen');
  assert.equal(complete('/note "two wo', '"two words"'), '/note "two words"');
});

test('schemas from Python types get their editors and starting values', () => {
  const literal = { enum: ['yes', 'no'], type: 'string' };
  assert.deepEqual(editorOf(literal, literal), { kind: 'choice', options: ['yes', 'no'] });
  assert.equal(editorOf({ type: 'integer' }, {}).kind, 'integer');
  const optional = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
  assert.deepEqual(editorOf(optional, optional), { kind: 'optional', inner: { type: 'integer' } });
  const options = {
    type: 'object',
    properties: { depth: { type: 'integer', default: 2 }, loud: { type: 'boolean', default: false }, mode: { $ref: '#/$defs/Mode' } },
    required: ['depth'],
    $defs: { Mode: { enum: ['fast', 'slow'], default: 'fast' } },
  };
  const editor = editorOf(options, options);
  assert.equal(editor.kind, 'object');
  assert.deepEqual(editor.fields.map((f) => [f.name, f.required]), [['depth', true], ['loud', false], ['mode', false]]);
  assert.deepEqual(initial(options, options), { depth: 2, loud: false, mode: 'fast' });
  assert.equal(editorOf({ type: 'array', items: { type: 'string' } }, {}).kind, 'json', 'anything else is JSON, said so');
  assert.throws(() => editorOf({ $ref: '#/$defs/Gone' }, {}), /does not define/);
});
