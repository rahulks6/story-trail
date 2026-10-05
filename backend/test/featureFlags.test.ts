import './env';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app';
import { config } from '../src/config/env';
import { placements } from '../src/modules/ads/ads.service';
it('new features default off and unauthenticated admin routes remain inaccessible', async () => {
    assert.equal(config.features.admin, false);
    assert.equal(config.features.ads, false);
    assert.equal(config.features.sponsored, false);
    assert.deepEqual(await placements('00000000-0000-0000-0000-000000000000', 20), []);
    const server = buildApp();
    await new Promise<void>(r => server.listen(0, r));
    try {
        const port = (server.address() as {
            port: number;
        }).port;
        assert.equal((await fetch(`http://127.0.0.1:${port}/admin`)).status, 404);
        assert.equal((await fetch(`http://127.0.0.1:${port}/api/v1/admin/reports`)).status, 404);
    }
    finally {
        await new Promise<void>(r => server.close(() => r()));
    }
});
