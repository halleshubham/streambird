import { test, expect } from '@playwright/test';
// TEMPORARY: proves the aggregator job `test` fails when a shard fails. Reverted right after.
test('ci proof: deliberately failing', async () => { expect(1).toBe(2); });
