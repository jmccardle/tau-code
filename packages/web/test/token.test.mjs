import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_KEY, clientId, takeToken } from '../dist-tsc/token.js';

function place(hash, stored = {}) {
  const storage = new Map(Object.entries(stored));
  const replaced = [];
  return {
    replaced,
    storage,
    place: {
      location: { hash, pathname: '/', search: '' },
      history: { replaceState: (_data, _unused, url) => replaced.push(url) },
      storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    },
  };
}

test('#token= is read, kept in this tab, and removed from the address (Q-I)', () => {
  const at = place('#token=abc');
  assert.equal(takeToken(at.place), 'abc');
  assert.equal(at.storage.get(TOKEN_KEY), 'abc');
  assert.deepEqual(at.replaced, ['/']);
});

test('other fragment keys survive the token\'s removal', () => {
  const at = place('#token=abc&cursor=2');
  takeToken(at.place);
  assert.deepEqual(at.replaced, ['/#cursor=2']);
});

test('a reload without the fragment uses the tab\'s token; none at all is null', () => {
  const reload = place('', { [TOKEN_KEY]: 'abc' });
  assert.equal(takeToken(reload.place), 'abc');
  assert.deepEqual(reload.replaced, [], 'nothing to remove');
  assert.equal(takeToken(place('').place), null);
});

test('the client id is stable within a tab', () => {
  const at = place('');
  let n = 0;
  const random = () => `t${n++}`;
  assert.equal(clientId('127.0.0.1:3393', at.place.storage, random), 'web@127.0.0.1:3393:t0');
  assert.equal(clientId('127.0.0.1:3393', at.place.storage, random), 'web@127.0.0.1:3393:t0');
});
