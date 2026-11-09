// Pull a GitHub repo's files through the jsdelivr CDN (works where github.com is TLS-intercepted).
// usage: node fetch-repo.mjs <owner/repo> <ref> <dest>
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";

const [REPO, REF, DEST] = process.argv.slice(2);
if (!REPO || !REF || !DEST) {
  console.error("usage: node fetch-repo.mjs <owner/repo> <ref> <dest>");
  process.exit(2);
}

const root = normalize(DEST);
const listUrl = `https://data.jsdelivr.com/v1/packages/gh/${REPO}@${REF}?structure=flat`;
const res = await fetch(listUrl);
if (!res.ok) {
  console.error(`listing failed: HTTP ${res.status}`);
  process.exit(1);
}
const { files } = await res.json();
console.log(`manifest: ${files.length} files`);

let ok = 0;
const failed = [];
for (const f of files) {
  const rel = f.name.replace(/^\/+/, "");
  const out = normalize(join(root, rel));
  if (!out.startsWith(root + sep)) {
    failed.push(`${rel}: refused (outside dest)`);
    continue;
  }
  const url = `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/${rel}`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
    ok++;
  } catch (e) {
    failed.push(`${rel}: ${e.message}`);
  }
}

console.log(`downloaded ${ok}/${files.length}`);
if (failed.length) {
  console.error("FAILED:");
  for (const f of failed) console.error("  " + f);
  process.exit(1);
}
