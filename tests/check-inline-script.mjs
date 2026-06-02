import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.full_with_map_preview.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
    throw new Error('inline script not found');
}

new vm.Script(match[1], {
    filename: 'index.full_with_map_preview.inline.js'
});

console.log('inline-js-ok');
