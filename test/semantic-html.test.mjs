import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { htmlInternals } from "../format.mjs";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const { decodeHTML, decodeHTMLAttribute } = await import(pathToFileURL(runtimeRequire.resolve("entities")));
const semantic = { decodeHTML, decodeHTMLAttribute };
const normalized = (html) => htmlInternals.normalizedHtml(html, undefined, 0, null, semantic);

test("セルの描画の正規化は、文字と属性の実体参照・属性の順・空要素の / だけをそろえる", () => {
  const same = [
    ['<p>&quot;&nbsp;&#39;&copy;</p>', '<p>"\u00a0\'©</p>'],
    ["<p>&#9;a&#10;b</p>", "<p>a b</p>"],
    ["<pre>&#10;a&#10;</pre>", "<pre>\na\n</pre>"],
    ['<img title="&quot;" alt=文字 src="a.png">', '<img src=a.png alt="文字" title=\'"\' />'],
    ['<input type="checkbox" checked disabled>', '<input disabled="" checked="" type=checkbox />'],
    ['<p title="先" title="後">x</p>', '<p title="先">x</p>'],
    ['<P TITLE="先" title="後">x</P>', '<p title="先">x</p>'],
    ['<img src="https://例.jp/a">', '<img src="https://%E4%BE%8B.jp/a" />'],
    ['<a href="https://例.jp/a" title="題">文字</a>', '<a title=題 href="https://%E4%BE%8B.jp/a">文字</a>'],
    ['<img src="a%zz" alt="a">', '<img alt=a src="a%zz" />'],
    ['<p title="&copy=">x</p>', '<p title="&amp;copy=">x</p>'],
  ];
  for (const [a, b] of same) assert.equal(normalized(a), normalized(b), a + " と " + b);
  const different = [
    ['<p title="先" title="後">x</p>', '<p title="後">x</p>'],
    ['<p title="a  b">x</p>', '<p title="a b">x</p>'],
    ['<p title="&copy">x</p>', '<p title="&amp;copy">x</p>'],
    ["<p>&nbsp;</p>", "<p> </p>"],
    ["<code>&amp;lt;</code>", "<code>&lt;</code>"],
    ["<code>a  b</code>", "<code>a b</code>"],
    ["<b>a</b><i>b</i>", "<b>a</b> <i>b</i>"],
    ["<span />x</span>", "<span>x</span>"],
    ["<svg><img /></svg>", "<svg><img></svg>"],
    ["<math><br /></math>", "<math><br></math>"],
    ["<img src=a/>", "<img src=a />"],
    ['<img src="https://example.com/a%2Fb">', '<img src="https://example.com/a/b">'],
    ["<!-- &copy; -->", "<!-- © -->"],
  ];
  for (const [a, b] of different) assert.notEqual(normalized(a), normalized(b), a + " と " + b);
});

test("セルの描画の正規化でも、生の文字の要素の中の実体参照は戻さない", () => {
  for (const name of ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]) {
    assert.notEqual(normalized("<" + name + ">&amp;</" + name + ">"),
      normalized("<" + name + ">&</" + name + ">"), name);
  }
  assert.notEqual(htmlInternals.normalizedHtml("&amp;</xmp>", undefined, 0, "xmp", semantic),
    htmlInternals.normalizedHtml("&</xmp>", undefined, 0, "xmp", semantic));
});

test("セルの描画の正規化は、文字と行き先の同じ裸の URL・www.・メールのリンクだけを外す", () => {
  const same = [
    ['<p><a href="https://example.com">https://example.com</a></p>', '<p>https://example.com</p>'],
    ['<p>前 <a href="https://例.jp/a?x=1&amp;y=2">https://例.jp/a?x=1&amp;y=2</a> 後</p>',
      '<p>前 https://例.jp/a?x=1&amp;y=2 後</p>'],
    ['<p><a href="http://www.example.com">www.example.com</a></p>', '<p>www.example.com</p>'],
    ['<p><a href="mailto:a@example.com">a@example.com</a></p>', '<p>a@example.com</p>'],
    ['<p><a href="https://%E4%BE%8B.jp">https://例.jp</a></p>', '<p>https://例.jp</p>'],
    ['<p>a<a href="https://example.com">https://example.com</a>b</p>', '<p>ahttps://example.comb</p>'],
  ];
  for (const [a, b] of same) assert.equal(normalized(a), normalized(b), a + " と " + b);
  const different = [
    ['<a href="https://example.com">文字</a>', '文字'],
    ['<a href="https://example.com" title="題">https://example.com</a>', 'https://example.com'],
    ['<a href="https://example.com"><b>https://example.com</b></a>', '<b>https://example.com</b>'],
    ['<a href="https://example.com">https://example.com<!-- c --></a>', 'https://example.com<!-- c -->'],
    ['<a href="https://www.example.com">www.example.com</a>', 'www.example.com'],
    ['<svg><a href="https://example.com">https://example.com</a></svg>', '<svg>https://example.com</svg>'],
  ];
  for (const [a, b] of different) assert.notEqual(normalized(a), normalized(b), a + " と " + b);
});

test("semantic を渡さない描画の正規化は従来どおり厳しく比べる", () => {
  const different = [
    ["<p>&quot;</p>", '<p>"</p>'],
    ['<input checked disabled>', '<input disabled checked>'],
    ['<input checked>', '<input checked="">'],
    ["<img>", "<img />"],
    ['<img src="https://例.jp">', '<img src="https://%E4%BE%8B.jp">'],
    ['<a href="https://example.com">https://example.com</a>', 'https://example.com'],
  ];
  for (const [a, b] of different) assert.notEqual(htmlInternals.normalizedHtml(a), htmlInternals.normalizedHtml(b), a + " と " + b);
});
