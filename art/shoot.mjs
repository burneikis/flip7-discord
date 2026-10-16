// Screenshot the active browser tab at an exact size.
// usage: node art/shoot.mjs <out.png> <width> <height> [scale=1] [url]
import { createRequire } from 'node:module';
const require = createRequire(process.env.HOME + '/.pi/agent/skills/browser-tools/package.json');
const puppeteer = require('puppeteer-core');

const [out, w, h, scale = '1', url] = process.argv.slice(2);
const b = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
const p = (await b.pages()).at(-1);
await p.setViewport({ width: +w, height: +h, deviceScaleFactor: +scale });
if (url) await p.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600));
await p.screenshot({ path: out, omitBackground: false });
console.log(out);
await b.disconnect();
