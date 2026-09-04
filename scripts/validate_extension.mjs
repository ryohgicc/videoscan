import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const manifestPath = path.join(root, 'extension', 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

const requiredFiles = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts || []).flatMap((script) => [...(script.js || []), ...(script.css || [])]),
].filter(Boolean);

for (const file of requiredFiles) {
  await fs.access(path.join(root, 'extension', file));
}

if (manifest.manifest_version !== 3) {
  throw new Error('extension manifest must use Manifest V3');
}

if (!manifest.host_permissions?.some((item) => item.includes('localhost:3333'))) {
  throw new Error('extension must allow localhost VideoScan API access');
}

console.log(`Validated extension manifest and ${requiredFiles.length} referenced files.`);
