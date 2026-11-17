// Generate thesis-ready HTML/PDF from docs/AgriCoop_System_Documentation.md
// Prerequisite: pnpm exec playwright install chromium
// Usage: node scripts/build-system-docs.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const mdPath = join(root, "docs", "AgriCoop_System_Documentation.md");
const htmlPath = join(root, "docs", "AgriCoop_System_Documentation.html");
const pdfPath = join(root, "docs", "AgriCoop_System_Documentation.pdf");

const PRINT_CSS = `
@page {
  size: A4;
  margin: 20mm 18mm 22mm 18mm;
}
* { box-sizing: border-box; }
html { font-size: 11pt; }
body {
  font-family: "Segoe UI", Georgia, "Times New Roman", serif;
  line-height: 1.45;
  color: #1a1a1a;
  max-width: 100%;
  margin: 0;
  padding: 0;
}
h1, h2, h3, h4 {
  break-after: avoid;
  page-break-after: avoid;
}
h1 { font-size: 1.75rem; margin-top: 0; }
h2 {
  font-size: 1.25rem;
  margin-top: 1.75rem;
  border-bottom: 1px solid #ccc;
  padding-bottom: 0.25rem;
}
h3 { font-size: 1.05rem; margin-top: 1.25rem; }
p, li { orphans: 3; widows: 3; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
  margin: 0.75rem 0 1rem;
  break-inside: avoid;
  page-break-inside: avoid;
}
th, td {
  border: 1px solid #bbb;
  padding: 0.35rem 0.5rem;
  vertical-align: top;
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
th { background: #f3f3f3; font-weight: 600; }
pre {
  background: #f6f6f6;
  border: 1px solid #ddd;
  padding: 0.6rem;
  overflow-x: auto;
  font-size: 0.8rem;
  break-inside: avoid;
}
code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.88em;
}
blockquote {
  margin: 0.5rem 0;
  padding-left: 1rem;
  border-left: 3px solid #888;
  color: #444;
}
.toc { margin: 1rem 0 2rem; }
.toc ol { padding-left: 1.25rem; }
.mermaid {
  break-inside: avoid;
  page-break-inside: avoid;
  margin: 1rem 0;
  text-align: center;
}
hr { border: none; border-top: 1px solid #ccc; margin: 1.5rem 0; }
`;

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlDocument(markdown) {
  const escaped = escapeHtml(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgriCoop Marketplace — System Documentation</title>
  <style>${PRINT_CSS}</style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"><\/script>
</head>
<body>
  <article id="content"></article>
  <script type="text/plain" id="source">${escaped}</script>
  <script>
    (function () {
      const source = document.getElementById("source").textContent;
      const renderer = new marked.Renderer();
      const originalCode = renderer.code.bind(renderer);
      renderer.code = function (code, infostring) {
        const lang = (infostring || "").trim().toLowerCase();
        if (lang === "mermaid") {
          return '<div class="mermaid">' + code + "</div>";
        }
        return originalCode(code, infostring);
      };
      marked.setOptions({ renderer, gfm: true, breaks: false });
      document.getElementById("content").innerHTML = marked.parse(source);
      mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
      mermaid.run({ nodes: document.querySelectorAll(".mermaid") }).catch(function (err) {
        console.error(err);
        document.body.insertAdjacentHTML(
          "beforeend",
          '<p style="color:#b00;">Mermaid diagram rendering failed. See browser console.</p>'
        );
      });
    })();
  <\/script>
</body>
</html>`;
}

async function main() {
  if (!existsSync(mdPath)) {
    console.error("Missing source markdown:", mdPath);
    process.exit(1);
  }

  const markdown = readFileSync(mdPath, "utf8");
  const html = buildHtmlDocument(markdown);
  writeFileSync(htmlPath, html, "utf8");
  console.log("Wrote", htmlPath);

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
    await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForFunction(
      () => {
        const content = document.getElementById("content");
        if (!content || content.children.length === 0) return false;
        const blocks = document.querySelectorAll(".mermaid");
        if (blocks.length === 0) return true;
        const svgs = document.querySelectorAll(".mermaid svg").length;
        const failed = /Mermaid diagram rendering failed/.test(document.body.innerText);
        return svgs >= blocks.length || failed;
      },
      { timeout: 120_000 },
    );
    await page.waitForTimeout(1500);
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
    });
    console.log("Wrote", pdfPath);
  } catch (err) {
    console.error("PDF generation failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();