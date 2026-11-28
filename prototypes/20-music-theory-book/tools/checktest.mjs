// Opens the sound source's check page (engine/sound-check.html) the way it
// is published, clicks its four buttons in order and prints the report box.
// Usage: node checktest.mjs [page path in the prototype folder]
import { openPage } from './serve.mjs';

const [, , file = 'engine/sound-check.html'] = process.argv;
const { page, errors, close } = await openPage(file, 700);
for (const id of ['#t1', '#t2', '#t3', '#t4']) { await page.click(id); await page.waitForTimeout(900); }
console.log(await page.$eval('#report', (t) => t.value));
if (errors.length) console.log('errors:', errors.join(' | '));
await close();
