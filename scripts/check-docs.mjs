#!/usr/bin/env node
import { readFile, readdir, stat, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function markdown(directory) {
  const files = [];
  for (const e of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, e.name);
    if (e.isDirectory()) files.push(...(await markdown(path)));
    else if (e.name.endsWith(".md")) files.push(path);
  }
  return files;
}
const files = [
  join(root, "README.md"),
  ...(await markdown(join(root, "docs"))),
];
const diagrams = [];
let links = 0;
for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const local = decodeURIComponent(href.split("#")[0].split(":")[0]);
    const path = resolve(dirname(file), local);
    if (!path.startsWith(root + sep))
      throw new Error(`Link escapes repository: ${file}: ${href}`);
    try {
      await stat(path);
    } catch {
      throw new Error(`Broken link: ${file}: ${href}`);
    }
    links++;
  }
  for (const match of text.matchAll(/```mermaid\s*\n([\s\S]*?)```/g))
    diagrams.push({ file, code: match[1] });
}
const vendor = join(root, "frontend/node_modules/mermaid/dist");
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<html><head><meta charset="utf-8"></head><body><script type="module">import mermaid from '/vendor/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',fontFamily:'Arial',flowchart:{useMaxWidth:false},sequence:{useMaxWidth:false}});window.mermaid=mermaid;</script></body></html>`,
      );
      return;
    }
    const path = resolve(
      vendor,
      "." +
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname.replace("/vendor", ""),
        ),
    );
    if (!path.startsWith(vendor + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      "Content-Type",
      [".js", ".mjs"].includes(extname(path))
        ? "application/javascript"
        : "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const artifacts = await mkdtemp(join(tmpdir(), "commonplace-diagrams-"));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
  });
  await page.goto("http://127.0.0.1:" + port);
  await page.waitForFunction(() => window.mermaid);
  for (let index = 0; index < diagrams.length; index++) {
    const diagram = diagrams[index];
    try {
      await page.evaluate(
        async ({ code, id }) => {
          const result = await window.mermaid.render(id, code);
          document.body.innerHTML = result.svg;
          document.body.style.margin = "24px";
        },
        { code: diagram.code, id: "diagram" + index },
      );
      await page
        .locator("svg")
        .screenshot({
          path: join(artifacts, String(index + 1).padStart(2, "0") + ".png"),
        });
    } catch (error) {
      throw new Error(
        `Mermaid render failed in ${diagram.file}: ${error.message}`,
      );
    }
  }
  console.log(
    `Verified ${links} repository links and rendered ${diagrams.length} Mermaid diagrams from ${files.length} Markdown files.`,
  );
  console.log("Diagram previews: " + artifacts);
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
