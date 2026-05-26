import assert from 'node:assert/strict';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  resizeTableColumn,
  reorderTableColumns,
} from '../web/src/lib/tablePreferences';

assert.equal(DEFAULT_TABLE_PAGE_SIZE, 50, 'tables default to 50 rows per page');

assert.deepEqual(
  reorderTableColumns(['sku', 'status', 'stock', 'updated'], 'updated', 'status'),
  ['sku', 'updated', 'status', 'stock'],
  'dragged columns are inserted before the drop target',
);

assert.deepEqual(
  reorderTableColumns(['sku', 'status', 'stock'], 'sku', 'missing'),
  ['sku', 'status', 'stock'],
  'unknown drop targets leave column order unchanged',
);

assert.equal(resizeTableColumn(120, 80), 200, 'column resizing adds drag delta');
assert.equal(resizeTableColumn(120, -200), 72, 'column resizing enforces minimum width');

console.log('table preferences guard passed');
