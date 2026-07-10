import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    scanContent,
    scanFile,
    stableHash,
    tokenizeContent
} from '../tools/hardcoded-content-scanner.mjs';

const runtimeCatalog = scanContent(`
const rows = [
    { song: 'Named Song', artist: 'Named Artist' }
];
`, { relativePath: 'index.html' });
assert.ok(runtimeCatalog.findings.some(item => item.category === 'runtime_content'));

const inlineFixture = scanContent(`
assert.equal(searchTest.isRelatedToQuery('Example Labs latest news', {
    title: 'Example Labs announces an update'
}), true);
`, { relativePath: 'tests/sample.test.mjs' });
assert.ok(inlineFixture.findings.some(item => item.category === 'test_fixture_inline'));

const neutralFixture = scanContent(`
assert.equal(searchTest.isRelatedToQuery(\`latest \${fixtureSubject('Organization')} news\`, {
    title: \`\${fixtureSubject('Organization')} announces an update\`
}), true);
`, { relativePath: 'tests/sample.test.mjs' });
assert.equal(neutralFixture.findings.length, 0);

const operationalConfig = scanContent(`
export const source = { name: 'NASA EONET', attribution: 'NASA Earth Observatory Natural Event Tracker' };
`, { relativePath: 'api/_lib/free-live/source-registry.js' });
assert.equal(operationalConfig.findings.length, 0);

assert.ok(tokenizeContent('Alpha beta Alpha').includes('Alpha'));
assert.equal(stableHash('same'), stableHash('same'));
assert.notEqual(stableHash('same'), stableHash('different'));

const tempDir = await mkdtemp(path.join(tmpdir(), 'hygiene-scanner-test-'));
try {
    const filePath = path.join(tempDir, 'fixture.mjs');
    const uniqueContent = `export const value = fixtureSubject("Device"); // ${Date.now()}`;
    await writeFile(filePath, uniqueContent, 'utf8');
    const first = await scanFile(filePath, { root: tempDir });
    const second = await scanFile(filePath, { root: tempDir });
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.findings.length, 0);
} finally {
    await rm(tempDir, { recursive: true, force: true });
}

console.log('hygiene-scanner-tests-ok');
