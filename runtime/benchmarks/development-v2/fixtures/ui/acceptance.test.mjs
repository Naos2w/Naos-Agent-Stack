import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '../.tools/playwright-core/index.mjs';
import {filterItems} from './view.mjs';

test('case-insensitive trimmed filtering preserves items and order',()=>{
 const items=[{name:'Aster'},{name:'MAPLE'}], before=JSON.stringify(items);
 assert.deepEqual(filterItems(items,'  aSt '),[items[0]]);
 assert.deepEqual(filterItems(items,'   '),items);
 assert.equal(JSON.stringify(items),before);
});
test('actual browser: keyboard filtering, safe text, empty state, live count and responsive layout',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
  await page.route('**/*',route=>route.abort());
  await page.setContent(await readFile('index.html','utf8'));
  const source=(await readFile('view.mjs','utf8')).replaceAll('export function','function');
  await page.addScriptTag({content:source+`
    const items=[{name:'Aster'},{name:'Maple'},{name:'<img src=x onerror="window.injected=true">'}];
    const root=document.querySelector('main');
    const refresh=()=>renderItems(root,filterItems(items,document.querySelector('#query').value));
    document.querySelector('#query').addEventListener('input',refresh);refresh();`});
  assert.equal(await page.locator('li').count(),3);
  assert.equal(await page.locator('li img').count(),0,'item names must render as literal text');
  assert.equal(await page.locator('#empty').isVisible(),false);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#query').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.type('  MAP  ');
  assert.equal(await page.locator('li').textContent(),'Maple');
  assert.match(await page.locator('[role=status]').textContent(),/1/);
  if(process.env.BENCHMARK_SCREENSHOTS)await page.screenshot({path:process.env.BENCHMARK_SCREENSHOTS+'/desktop.png'});
  await page.locator('#query').fill('unmatched');
  assert.equal(await page.locator('li').count(),0);
  assert.equal(await page.locator('#empty').isVisible(),true);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#query').fill('');
  assert.equal(await page.locator('li').count(),3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.BENCHMARK_SCREENSHOTS)await page.screenshot({path:process.env.BENCHMARK_SCREENSHOTS+'/mobile.png'});
 } finally {await browser.close();}
});
