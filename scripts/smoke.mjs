#!/usr/bin/env node
/**
 * End-to-end smoke test: start `tau serve`, say hello, open a session, and list
 * what it offers.
 *
 * Sends no prompt, so it costs no tokens and needs no reachable model. The
 * daemon runs in a throwaway HOME (scripts/lib/daemon.mjs); `~/.tau` is never
 * touched.
 *
 *   TAU_BIN=/path/to/venv/bin/tau node scripts/smoke.mjs
 */
import { check, connect, startDaemon } from './lib/daemon.mjs';
import { BUILT_AGAINST } from '../packages/protocol/dist/index.js';

const daemon = await startDaemon();
try {
  const client = await connect(daemon.url, 'smoke');
  const hello = client.helloResult;
  console.log(`tau serve ${hello.version} (pid ${hello.pid}) at protocol ${hello.protocol}, cwd ${hello.cwd}`);
  check(`the daemon speaks the protocol this client was generated against (${BUILT_AGAINST})`, hello.protocol === BUILT_AGAINST);

  const before = await client.request('list_sessions', {});
  check('a fresh store lists no sessions', before.sessions.length === 0);

  const opened = await client.request('new_session', { cwd: daemon.home });
  const session_id = opened.session.session_id;
  const attached = await client.request('attach', { session_id });
  console.log(`session ${session_id.slice(0, 8)} in ${attached.cwd}`);
  check('attach answers a snapshot', Array.isArray(attached.entries));
  check('the head cursor is one of the cursors', attached.cursors.some((c) => c.cursor_id === attached.head_cursor_id));
  check('the configured model is offered', attached.models.some((m) => m.name === 'unused'));

  const commands = attached.surface.commands;
  console.log(`\n${commands.length} commands:`);
  for (const command of commands.filter((c) => !c.hidden)) {
    console.log(`  /${command.name.padEnd(16)} ${command.origin.padEnd(9)} ${command.flow ? 'flow' : '    '}  ${command.description}`);
  }
  check('built-ins are listed with the vocabulary', commands.some((c) => c.origin === 'builtin'));

  const after = await client.request('list_sessions', {});
  check('the new session is listed', after.sessions.some((row) => row.session_id === session_id));

  client.close();
  console.log(process.exitCode ? '\nFAILED' : '\nOK');
} catch (error) {
  console.error('\nFAILED:', error instanceof Error ? error.message : error);
  console.error(daemon.output);
  process.exitCode = 1;
} finally {
  await daemon.stop();
}
