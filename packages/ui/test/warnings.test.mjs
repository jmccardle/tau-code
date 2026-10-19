/**
 * The status bar's extension-warnings marker and the panel's order.
 *
 *   node --test packages/ui/test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderWarnings, warningsLabel } from '../dist/warnings.js';

const warning = (key, severity) => ({ source: 'ext', key, message: key, severity });

test('nothing flagged is no marker', () => {
  assert.equal(warningsLabel([]), null);
});

test('the marker counts errors first and qualifies only the first count', () => {
  assert.equal(warningsLabel([warning('a', 'error')]), '1 extension error');
  assert.equal(warningsLabel([warning('a', 'warning'), warning('b', 'warning')]), '2 extension warnings');
  assert.equal(
    warningsLabel([warning('a', 'warning'), warning('b', 'error'), warning('c', 'warning')]),
    '1 extension error, 2 warnings',
  );
});

test('errors are listed before warnings, each in the order sent', () => {
  const rows = [warning('w1', 'warning'), warning('e1', 'error'), warning('w2', 'warning'), warning('e2', 'error')];
  assert.deepEqual(orderWarnings(rows).map((w) => w.key), ['e1', 'e2', 'w1', 'w2']);
});
