import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { formatMarkdown, htmlInternals } from "../format.mjs";

// Markdown に埋め込んだ HTML のブロックの整形 (html の分類)。整形の結果と、整形の前後で描画が変わらないことを確かめる。
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const formatterPath = path.join(packageDir, "format.mjs");
const runtimeDir = process.env.GLFM_FORMAT_RUNTIME_DIR || packageDir;
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const { markdownToHTML } = runtimeRequire("comrak");
const renderOptions = {
  extension: {
    descriptionLists: true, table: true, strikethrough: true, autolink: true, tasklist: true, footnotes: true,
    multilineBlockQuotes: true, mathDollars: true, mathCode: true, alerts: true,
  },
  parse: { relaxedTasklistMatching: true, leaveFootnoteDefinitions: true },
  render: { unsafe: true },
};
const { normalizedHtml } = htmlInternals;
const rendered = (text) => normalizedHtml(markdownToHTML(text, renderOptions));
const lines = (...rows) => rows.join("\n") + "\n";

async function project(t) {
  const cwd = await mkdtemp(path.join(tmpdir(), "glfm-html-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(path.join(cwd, ".markdownlint.json"), JSON.stringify({ default: true }));
  // HTML のブロックの整形だけを確かめる。入れ物の中の例は loose のリストのまま保つ (詰めることは lists.test.mjs で確かめる)。
  return { filename: path.join(cwd, "example.md"), cwd, runtimeDir, fixes: { tight_lists: false } };
}

// 整形の結果が expected になり、2 回目で変わらず、近道の有無で同じで、整形の前後で描画が変わらないこと。
async function assertFormats(options, input, expected, name) {
  const output = await formatMarkdown(input, options);
  assert.equal(output, expected, name);
  assert.equal(await formatMarkdown(output, options), output, `${name}: 2 回目で変わらない`);
  assert.equal(await formatMarkdown(input, { ...options, exhaustive: true }), output, `${name}: 近道の有無で同じ`);
  assert.equal(rendered(output), rendered(input), `${name}: 描画が変わらない`);
}

const tables = [
  ["1 行の表", lines("<table><tr><td>a</td><td>b</td></tr></table>"),
    lines("<table>", "  <tr>", "    <td>a</td>", "    <td>b</td>", "  </tr>", "</table>")],
  ["thead・tbody・th・属性・セルの中の br・code・kbd・pre と日本語",
    lines('<table><thead><tr><th>見出し</th><th>値</th></tr></thead><tbody><tr><td colspan="2" align="right">日本語の<b>文</b>です<br>次の行</td></tr><tr><td rowspan="2"><code>a  b</code> と <kbd>Ctrl</kbd>+<kbd>C</kbd></td><td><pre>  x', "    y</pre></td></tr></tbody></table>"),
    lines("<table>", "  <thead>", "    <tr>", "      <th>見出し</th>", "      <th>値</th>", "    </tr>", "  </thead>", "  <tbody>",
      "    <tr>", '      <td colspan="2" align="right">日本語の<b>文</b>です<br>次の行</td>', "    </tr>", "    <tr>",
      '      <td rowspan="2"><code>a  b</code> と <kbd>Ctrl</kbd>+<kbd>C</kbd></td>', "      <td>", "        <pre>  x", "    y</pre>",
      "      </td>", "    </tr>", "  </tbody>", "</table>")],
  ["入れ子の表", lines("<table>", "<tr><td><table><tr><td>入れ子</td></tr></table></td></tr>", "</table>"),
    lines("<table>", "  <tr>", "    <td>", "      <table>", "        <tr>", "          <td>入れ子</td>", "        </tr>", "      </table>",
      "    </td>", "  </tr>", "</table>")],
  // 開きの断片は階段になり、閉じの断片は行頭のまま (字下げすると 1 行目が 4 スペースになり、空行の後ではコードブロックになる)。
  ["セルの中の Markdown", lines("<table>", "<tr>", "<td>", "", "- セルの中の **Markdown**", "- 2 つ目", "", "</td>", "</tr>", "</table>"),
    lines("<table>", "  <tr>", "    <td>", "", "- セルの中の **Markdown**", "- 2 つ目", "", "</td>", "</tr>", "</table>")],
  ["リストの中の表", lines("- 項目", "", "  <table><tr><td>リストの中</td></tr></table>"),
    lines("- 項目", "", "  <table>", "    <tr>", "      <td>リストの中</td>", "    </tr>", "  </table>")],
  ["番号付きリストの印の行の表", lines("1. <table><tr><td>印の行</td></tr></table>"),
    lines("1. <table>", "     <tr>", "       <td>印の行</td>", "     </tr>", "   </table>")],
  ["引用の中の表", lines("> <table><tr><td>引用の中</td></tr></table>"),
    lines("> <table>", ">   <tr>", ">     <td>引用の中</td>", ">   </tr>", "> </table>")],
  ["引用の中のリストの中の表", lines("> - <table><tr><td>深い</td></tr></table>"),
    lines("> - <table>", ">     <tr>", ">       <td>深い</td>", ">     </tr>", ">   </table>")],
];

test("HTML の表を、入れ子・セルの中の Markdown・入れ物の中も含めて、描画を変えずに整形する", async (t) => {
  const options = await project(t);
  for (const [name, input, expected] of tables) await assertFormats(options, input, expected, name);
});

test("パイプの表と、そのセルの中のインライン HTML は変えない", async (t) => {
  const options = await project(t);
  const input = lines("| パイプ | 表 |", "| --- | --- |", "| <b>a</b> | b<br>c |", "", "<table><tr><td>隣</td></tr></table>");
  const expected = lines("| パイプ | 表 |", "| --- | --- |", "| <b>a</b> | b<br>c |", "", "<table>", "  <tr>", "    <td>隣</td>", "  </tr>", "</table>");
  await assertFormats(options, input, expected, "パイプの表の隣の HTML の表");
});

test("HTML の中の Markdown と入れ子の HTML は、断片ごとに整形し、間の Markdown と空行は変えない", async (t) => {
  const options = await project(t);
  const cases = [
    ["details と Markdown の本文", lines("<details>", "<summary>概要</summary>", "", "本文 **太字**", "", "</details>"),
      lines("<details>", "  <summary>概要</summary>", "", "本文 **太字**", "", "</details>")],
    ["Markdown をはさんだ details の入れ子",
      lines("<details>", "<summary>外</summary>", "", "外の本文", "", "<details>", "<summary>内</summary>", "", "内の本文", "",
        "</details>", "", "</details>"),
      lines("<details>", "  <summary>外</summary>", "", "外の本文", "", "<details>", "  <summary>内</summary>", "", "内の本文", "",
        "</details>", "", "</details>")],
    ["1 つのブロックの中の入れ子", lines("<div><p>段落</p><ul><li>一</li><li>二</li></ul></div>"),
      lines("<div>", "  <p>段落</p>", "  <ul>", "    <li>一</li>", "    <li>二</li>", "  </ul>", "</div>")],
    ["空行の無い HTML の中の Markdown の記法 (生の文字のまま)", lines("<div>", "**生の文字**", "</div>"),
      lines("<div>", "  **生の文字**", "</div>")],
    ["番号付きリストの手順の中の折りたたみとコードブロック",
      lines("1. 手順", "", "   <details>", "   <summary>貼るコマンド（bash・21 行）</summary>", "", "   ```bash", "   ls", "   ```", "",
        "   </details>", "", "   - 確認"),
      lines("1. 手順", "", "   <details>", "     <summary>貼るコマンド（bash・21 行）</summary>", "", "   ```bash", "   ls", "   ```", "",
        "   </details>", "", "   - 確認")],
    ["説明リストの説明の中の HTML", lines("用語", ": <div><p>説明</p></div>"), lines("用語", ": <div>", "    <p>説明</p>", "  </div>")],
    ["front matter の中のタグは変えない", lines("---", "title: <div><p>x</p></div>", "---", "", "<div><p>本文</p></div>"),
      lines("---", "title: <div><p>x</p></div>", "---", "", "<div>", "  <p>本文</p>", "</div>")],
  ];
  for (const [name, input, expected] of cases) await assertFormats(options, input, expected, name);
});

test("描画や GitLab の記法が変わりうる HTML と、整形済みの HTML は変えない", async (t) => {
  const options = await project(t);
  const unchanged = [
    ["pre で始まるブロック", lines("<pre>", "  そのまま  ", "</pre>")],
    ["textarea で始まるブロック", lines("<textarea>", "  そのまま", "</textarea>")],
    ["コメントのブロック", lines("<!-- markdownlint-disable MD033 -->")],
    ["段落の中のインライン HTML", lines("段落の中の <span>インライン</span> HTML。")],
    // 字下げすると、行頭の ::include の照合が変わる。
    ["行頭の include を含むブロック", lines("<div>", "::include{file=a.md}", "</div>")],
    // 脚注の定義の続きの行は 4 スペースで、1 行目の接頭辞 ([^1]: ) と幅が違う。
    ["脚注の定義の行に続けて書いた 1 行の HTML", lines("本文[^1]", "", "[^1]: <div><p>脚注</p></div>")],
    ["整形済みの表", tables[0][2]],
    ["整形済みの折りたたみ", lines("<details>", "  <summary>概要</summary>", "", "本文", "", "</details>")],
  ];
  for (const [name, input] of unchanged) await assertFormats(options, input, input, name);
});

test("CRLF の文書は CRLF のまま整形する", async (t) => {
  const options = await project(t);
  const input = "<table><tr><td>a</td></tr></table>\r\n\r\n本文\r\n";
  await assertFormats(options, input, "<table>\r\n  <tr>\r\n    <td>a</td>\r\n  </tr>\r\n</table>\r\n\r\n本文\r\n", "CRLF");
});

test("範囲整形では、選択に丸ごと入る HTML のブロックだけを整形する", async (t) => {
  const options = await project(t);
  const input = lines("<table><tr><td>一</td></tr></table>", "", "<table><tr><td>二</td></tr></table>", "", "末尾");
  const second = lines("<table><tr><td>一</td></tr></table>", "", "<table>", "  <tr>", "    <td>二</td>", "  </tr>", "</table>", "", "末尾");
  assert.equal(await formatMarkdown(input, { ...options, range: { start: [3, 0], end: [3, Infinity] } }), second);
  // ブロックの途中から選んだときは変えない。
  assert.equal(await formatMarkdown(input, { ...options, range: { start: [3, 5], end: [3, Infinity] } }), input);
});

test("html = false で HTML のブロックを整形せず、綴り違いはエラーにする", async (t) => {
  const options = await project(t);
  const input = tables[0][1];
  assert.equal(await formatMarkdown(input, { ...options, fixes: { html: false } }), input);
  assert.equal(await formatMarkdown(input, { ...options, fixes: { HTML: true } }), tables[0][2]);
  await assert.rejects(formatMarkdown(input, { ...options, fixes: { htm: false } }), /分類名にもルール名にも/);
  await assert.rejects(formatMarkdown(input, { ...options, fixes: { html: true, HTML: false } }), /有効と無効の両方/);
  const cli = (args) => spawnSync(process.execPath, [formatterPath, "--runtime-dir", runtimeDir, "--filename", options.filename, ...args],
    { cwd: options.cwd, input, encoding: "utf8", timeout: 15000 });
  assert.equal(cli(["--disable-fixes", "html"]).stdout, input);
  assert.equal(cli([]).stdout, tables[0][2]);
});

test("描画・構造を変える整形の結果は、ブロックごとに拒む", async (t) => {
  const options = await project(t);
  const breaking = [
    // 空行はブロックを終わらせ、後ろの行を Markdown にする。
    ["空行を入れる", lines("<div><p>x</p></div>"), (text) => text.replace("><", ">\n\n<")],
    // 1 行目を 4 スペース字下げすると、空行の後ではコードブロックになる。
    ["1 行目を 4 スペース字下げする", lines("本文", "", "<div><p>x</p></div>"), (text) => `    ${text}`],
    ["pre の中を変える", lines("<div><pre>  x</pre></div>"), (text) => text.replace("<pre>  x", "<pre>x")],
    ["code の中の空白を変える", lines("<div><code>a  b</code></div>"), (text) => text.replace("a  b", "a b")],
    ["インライン要素の間に空白を足す", lines("<p><b>a</b><i>b</i></p>"), (text) => text.replace("</b><i>", "</b> <i>")],
    ["インライン要素の間の空白を消す", lines("<p><b>a</b> <i>b</i></p>"), (text) => text.replace("</b> <i>", "</b><i>")],
    // prettier のように、閉じていない断片に閉じタグを足す。
    ["閉じタグを足す", lines("<details>", "<summary>概要</summary>", "", "本文", "", "</details>"),
      (text) => (text.startsWith("<details>") ? `${text}\n</details>` : text)],
    ["文字を変える", lines("<div><p>本文</p></div>"), (text) => text.replace("本文", "本 文")],
    ["GitLab の参照を変える", lines("<div><p>#123 を見る</p></div>"), (text) => text.replace("#123", "# 123")],
    ["属性を変える", lines('<div class="a"><p>x</p></div>'), (text) => text.replace('class="a"', 'class="b"')],
  ];
  for (const [name, input, beautifyHtml] of breaking) {
    const stats = {};
    assert.equal(await formatMarkdown(input, { ...options, beautifyHtml, stats }), input, name);
    // 空の行は当てる前に外す。ほかは当てて解析し直してから拒む (整形前の描画は必ず作る)。
    assert.equal(stats.renders > 0, name !== "空行を入れる", `${name}: ${JSON.stringify(stats)}`);
    if (name !== "空行を入れる") assert.ok(stats.parses >= 2, `${name}: 当てた文書を解析した: ${JSON.stringify(stats)}`);
  }
  // 壊すブロックだけを外し、ほかのブロックは整形する (まとめて確かめて落ち、半分に分けて確かめ直す)。
  const mixed = lines("<div><p>壊す</p></div>", "", "<div><p>直す</p></div>");
  const beautifyHtml = (text) => (text.includes("壊す") ? `    ${text}` : text.replace("><", ">\n  <").replace("</p><", "</p>\n<"));
  const stats = {};
  assert.equal(await formatMarkdown(mixed, { ...options, beautifyHtml, stats }),
    lines("<div><p>壊す</p></div>", "", "<div>", "  <p>直す</p>", "</div>"));
  // 元の文書・2 つまとめて・壊す方・直す方の 4 回。
  assert.equal(stats.parses, 4, JSON.stringify(stats));
  assert.equal(await formatMarkdown(mixed, { ...options, beautifyHtml: (text) => text.replace("<div>", "<section>") }), mixed);
  await assert.rejects(formatMarkdown(mixed, { ...options, beautifyHtml: "js-beautify" }), /beautifyHtml は関数/);
});

test("HTML の整形器が無い runtime では、HTML のブロックのある文書だけをエラーにする", async (t) => {
  const options = await project(t);
  // js-beautify だけを入れていない runtime (ほかの依存は本物へのジャンクション)。
  const partial = path.join(options.cwd, "runtime-without-js-beautify");
  await mkdir(path.join(partial, "node_modules"), { recursive: true });
  await writeFile(path.join(partial, "package.json"), "{}");
  for (const name of ["comrak", "markdownlint-cli2"]) {
    await symlink(path.join(runtimeDir, "node_modules", name), path.join(partial, "node_modules", name), "junction");
  }
  const settings = { ...options, runtimeDir: partial };
  assert.equal(await formatMarkdown("#  見出し\n\n本文 <b>強調</b>\n", settings), "# 見出し\n\n本文 <b>強調</b>\n",
    "インライン HTML だけの文書は js-beautify を読まない");
  await assert.rejects(formatMarkdown(tables[0][1], settings), /js-beautify.*導入スクリプト/u);
  await assert.rejects(formatMarkdown(tables[0][2], settings), /js-beautify.*導入スクリプト/u, "整形済みでも、確かめるには読む");
  assert.equal(await formatMarkdown(tables[0][1], { ...settings, fixes: { html: false } }), tables[0][1]);
});

test("HTML のブロックの無い文書と整形済みの文書は描画しない", async (t) => {
  const options = await project(t);
  for (const input of ["# 見出し\n\n<https://example.com> と <b>強調</b>\n", tables[0][2]]) {
    const stats = {};
    assert.equal(await formatMarkdown(input, { ...options, stats }), input);
    assert.equal(stats.renders, 0, JSON.stringify(stats));
  }
  const stats = {};
  await formatMarkdown("# 見出し\n\n本文\n", { ...options, stats });
  assert.ok(stats.parses <= 1, `HTML の行の無い文書は解析を増やさない: ${JSON.stringify(stats)}`);
});

test("描画の比較の正規化", () => {
  const same = [
    ["<div><p>x</p></div>", "<div>\n  <p>x</p>\n</div>"],
    ["<td> a </td>", "<td>a</td>"],
    ["<p>a\n  b</p>", "<p>a b</p>"],
    ["a<br>\n b", "a<br>b"],
    ['<td colspan = "2"  align="right" >x</td>', '<td colspan="2" align="right">x</td>'],
    ["<div><!-- c --><p>x</p></div>", "<div><!-- c -->\n  <p>x</p>\n</div>"],
    ["<details>\n<summary>概要</summary>\n", "<details>\n  <summary>概要</summary>\n"],
  ];
  for (const [a, b] of same) assert.equal(normalizedHtml(a), normalizedHtml(b), `${a} と ${b} は同じ描画`);
  const different = [
    ["<b>a</b><i>b</i>", "<b>a</b> <i>b</i>"],
    ["<pre>  x</pre>", "<pre>x</pre>"],
    ["<code>a  b</code>", "<code>a b</code>"],
    ['<div style="white-space: pre">a  b</div>', '<div style="white-space: pre">a b</div>'],
    ["<pre><pre>a  </pre>  b</pre>", "<pre><pre>a  </pre> b</pre>"],
    ['<td title="a  b">x</td>', '<td title="a b">x</td>'],
    ["<!-- a  b -->", "<!-- a b -->"],
    ["<p>本文</p>", "<p>本 文</p>"],
  ];
  for (const [a, b] of different) assert.notEqual(normalizedHtml(a), normalizedHtml(b), `${a} と ${b} は別の描画`);
});
