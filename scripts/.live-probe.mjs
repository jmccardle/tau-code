import WebSocket from 'ws';
import { ServeClient, Replica } from '../packages/protocol/dist/index.js';

function transport(url) {
  const socket = new WebSocket(url);
  let onMessage = () => {}, onClose = () => {};
  const queue = [];
  socket.on('open', () => { for (const f of queue.splice(0)) socket.send(f); });
  socket.on('message', (data) => onMessage(JSON.parse(data.toString())));
  socket.on('close', (code, reason) => onClose(reason.toString() || 'closed', code));
  return {
    send: (frame) => (socket.readyState === 1 ? socket.send(JSON.stringify(frame)) : queue.push(JSON.stringify(frame))),
    onMessage: (h) => (onMessage = h), onClose: (h) => (onClose = h), close: () => socket.close(),
  };
}

const client = new ServeClient(transport('ws://127.0.0.1:8399/'));
const hello = await client.hello('probe', null);
console.log('hello', hello);
const { session_id } = await client.request('create_session', { cwd: '/tmp/claude-1000/-home-john-Development-tau-code/d3ac3a1c-cf83-4e78-9144-4b94c6500d22/scratchpad/live/work' });
const replica = new Replica(session_id);
const kinds = {};
client.on('event', (e) => { kinds[e.kind] = (kinds[e.kind] ?? 0) + 1; const r = replica.apply(e); if (r === 'gap') console.log('GAP', e.seq); });
const attached = await client.request('attach', { session_id });
replica.applyAttached(attached);
console.log('attached', { entries: attached.entries.length, head: attached.head_cursor_id, models: attached.models.map(m=>m.name), commands: attached.surface.commands.length });
const cursor_id = attached.head_cursor_id;
const one = client.request('submit', { session_id, cursor_id, text: 'first', multitask_strategy: 'enqueue', expand_attachments: true, submission_id: 'p1' });
await new Promise((r) => setTimeout(r, 300));
const two = client.request('submit', { session_id, cursor_id, text: 'second @notes.txt', multitask_strategy: 'enqueue', expand_attachments: true, submission_id: 'p2' });
console.log('results', await one, await two);
const comp = await client.request('complete_path', { session_id, text: 'read @no', offset: 8 });
console.log('complete', JSON.stringify(comp));
const tree = await client.request('get_tree', { session_id, cursor_id });
console.log('tree', tree.count, tree.nodes.map(n => n.kind + ':' + (n.role ?? '')).join(' '));
const leaf = replica.cursor(cursor_id).leaf;
console.log('path', replica.path(leaf).entries.map(e => e.type + (e.message ? ':' + e.message.role : '') + (e.status ? '!' + e.status : '')).join(' '));
console.log('kinds', kinds);
client.close();
