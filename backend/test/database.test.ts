import './env';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { queryOne } from '../src/db/psql';
it('psql parameters round-trip Unicode, quotes, newlines and metacommand-looking input', async () => {
    for (const value of ['🔥 नमस्ते', 'quote\' and \\ slash', 'line one\nline two', 'x\'\n\\! echo must-not-run\nSELECT 1; --', '`literal`']) {
        const row = await queryOne(`SELECT :'value' AS value`, { value });
        assert.equal(row?.value, value);
    }
});
