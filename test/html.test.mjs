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
  // Markdown をはさむ表は、断片の 1 行目を入れ物の字下げに保ち、table とすべての表の部品をそろえる。
  ["セルの中の Markdown", lines("<table>", "<tr>", "<td>", "", "- セルの中の **Markdown**", "- 2 つ目", "", "</td>", "</tr>", "</table>"),
    lines("<table>", "<tr>", "<td>", "", "- セルの中の **Markdown**", "- 2 つ目", "", "</td>", "</tr>", "</table>")],
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

test("HTML の中の Markdown と入れ子の HTML は、まとまりで整形し、間の Markdown と空行は変えない", async (t) => {
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
    // 空行と、まとまりのタグ列が変わる結果は当てる前に外す。ほかは当てた文書を解析し直してから拒む。
    const beforeApplying = name === "空行を入れる" || name === "閉じタグを足す";
    assert.equal(stats.renders > 0, !beforeApplying, `${name}: ${JSON.stringify(stats)}`);
    if (!beforeApplying) assert.ok(stats.parses >= 2, `${name}: 当てた文書を解析した: ${JSON.stringify(stats)}`);
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

// 表の部品をそろえても、pre はセルの子として 2 つ字下げし、中の空白は保つ。
const markdownTable = [
  lines("<table>", "<thead>", '<tr><th rowspan="2">区分</th><th colspan="2">内容</th></tr>', "<tr><th>項目</th><th>説明</th></tr>",
    "</thead>", "<tbody>", "<tr>", '<td rowspan="2">導入</td>', "<td><code>dnf</code></td>", "<td>", "",
    "- パッケージを入れる", "- **root** で実行する", "", "</td>", "</tr>", "<tr>", "<td>コード</td>",
    '<td><pre><code class="language-sh">sudo dnf install -y epel-release</code></pre></td>', "</tr>", "</tbody>", "</table>"),
  lines("<table>", "<thead>", "<tr>", '<th rowspan="2">区分</th>', '<th colspan="2">内容</th>', "</tr>", "<tr>",
    "<th>項目</th>", "<th>説明</th>", "</tr>", "</thead>", "<tbody>", "<tr>", '<td rowspan="2">導入</td>',
    "<td><code>dnf</code></td>", "<td>", "", "- パッケージを入れる", "- **root** で実行する", "", "</td>", "</tr>",
    "<tr>", "<td>コード</td>", "<td>", '  <pre><code class="language-sh">sudo dnf install -y epel-release</code></pre>',
    "</td>", "</tr>", "</tbody>", "</table>"),
];

test("Markdown のセルを持つ表は、見出しとほかのセルも表の字下げにそろえる", async (t) => {
  const options = await project(t);
  await assertFormats(options, ...markdownTable, "thead・Markdown のセル・pre のセル");
  const input = lines("<table>", "  <tr>", "    <td>a</td>", "    <td>", "", "本文", "", "</td>", "</tr>",
    "<tr><td>b</td><td>c</td></tr>", "</table>");
  const expected = lines("<table>", "<tr>", "<td>a</td>", "<td>", "", "本文", "", "</td>", "</tr>", "<tr>",
    "<td>b</td>", "<td>c</td>", "</tr>", "</table>");
  await assertFormats(options, input, expected, "開きと閉じの字下げがずれている表");
  await assertFormats(options, expected, expected, "そろえた表");
});

test("リストと引用の中でも、Markdown をはさむ表の字下げを入れ物にそろえる", async (t) => {
  const options = await project(t);
  for (const marker of ["- ", "1. ", "> "]) {
    const quoted = marker === "> ";
    const prefix = quoted ? marker : " ".repeat(marker.length);
    const wrap = (text) => (quoted ? "" : marker + "項目\n\n") +
      text.trimEnd().split("\n").map((row) => row ? prefix + row : quoted ? ">" : "").join("\n") + "\n";
    await assertFormats(options, wrap(markdownTable[0]), wrap(markdownTable[1]), marker);
  }
});

test("Markdown をはさむ div と祖先の details をそろえ、summary は 2 つ字下げする", async (t) => {
  const options = await project(t);
  const input = lines("<details><summary>概要</summary><div>", "", "本文 **太字**", "", "</div></details>");
  const expected = lines("<details>", "  <summary>概要</summary>", "<div>", "", "本文 **太字**", "", "</div>", "</details>");
  await assertFormats(options, input, expected, "details の中の div");
});

test("続くまとまりと、1 ブロックで閉じる HTML は、それぞれの決まりで整形する", async (t) => {
  const options = await project(t);
  const details = [lines("<details><summary>概要</summary>", "", "本文", "", "</details>"),
    lines("<details>", "  <summary>概要</summary>", "", "本文", "", "</details>")];
  await assertFormats(options, markdownTable[0] + "\n" + details[0] + "\n" + tables[0][1],
    markdownTable[1] + "\n" + details[1] + "\n" + tables[0][2], "2 つのまとまりと閉じた表");
});

test("複数の断片で対が取れない HTML は変えず、1 ブロックの閉じタグは描画を確かめて整形する", async (t) => {
  const options = await project(t);
  const unchanged = [
    ["断片をまたいだ開きの無い閉じタグ", lines("<div>", "", "本文", "", "</span></div>")],
    ["入れ物の終わりまで閉じない", lines("<details><summary>概要</summary>", "", "本文")],
    ["入れ物をまたぐ", lines("- 項目", "", "  <div><p>本文</p>", "", "外の本文", "", "</div>")],
    ["前の断片の td を暗に閉じる", lines("<table><tr><td>", "", "本文", "", "</tr></table>")],
    ["前の断片の要素を同じ断片の子と一緒に閉じる", lines("<div>", "", "本文", "", "<p>文</div>")],
    ["途中の断片に開きの無い閉じタグ", lines("<div><p>文</p>", "", "本文", "", "</section></div>")],
  ];
  for (const [name, input] of unchanged) await assertFormats(options, input, input, name);
  // 同じ断片で開いた子だけを暗に閉じる HTML は、1 ブロックとして整形する。
  await assertFormats(options, lines("<div><p>文</div>"), lines("<div>", "  <p>文", "</div>"), "同じ断片の暗黙の閉じ");
  await assertFormats(options, lines("<p><div>文</p></div>"), lines("<p>", "<div>文</p>", "</div>"), "同じ断片の交差した閉じ");
  await assertFormats(options, lines("</section><div><p>本文</p></div>"),
    lines("</section>", "<div>", "  <p>本文</p>", "</div>"), "1 ブロックの開きの無い閉じタグ");
});

test("まとまりの範囲整形は、全断片が選ばれたときだけ行う", async (t) => {
  const options = await project(t);
  const input = lines("<details><summary>概要</summary>", "", "本文", "", "</details>");
  const expected = lines("<details>", "  <summary>概要</summary>", "", "本文", "", "</details>");
  for (const range of [
    { start: [1, 0], end: [1, Infinity] },
    { start: [5, 0], end: [5, Infinity] },
    { start: [1, 1], end: [5, Infinity] },
  ]) assert.equal(await formatMarkdown(input, { ...options, range }), input);
  assert.equal(await formatMarkdown(input, { ...options, range: { start: [1, 0], end: [5, Infinity] } }), expected);
});

test("1 つの断片の描画が変わればまとまり全体を拒み、独立したまとまりは整形する", async (t) => {
  const options = await project(t);
  const input = lines("<div><p>開き側</p>", "", "本文", "", "<p>閉じ側</p></div>");
  const beautifyHtml = (text, settings) => runtimeRequire("js-beautify").html(text, settings).replace("閉じ側", "閉 じ側");
  await assertFormats({ ...options, beautifyHtml }, input, input, "閉じ側だけ描画が変わるまとまり");
  const details = lines("<details><summary>概要</summary>", "", "次の本文", "", "</details>");
  const expectedDetails = lines("<details>", "  <summary>概要</summary>", "", "次の本文", "", "</details>");
  await assertFormats({ ...options, beautifyHtml }, input + "\n" + details + "\n" + tables[0][1],
    input + "\n" + expectedDetails + "\n" + tables[0][2], "半分に分けて確かめてもまとまりは分けない");
});

test("目印・複数行属性・空白保持要素・入れ子の表があっても、まとまりの文脈を保つ", async (t) => {
  const options = await project(t);
  const input = lines("<table><caption>題</caption><colgroup><col></colgroup><tbody><tr><td>", "", "本文", "",
    "</td></tr><tr><td><!--mdfmt-gap--><table><tr><td>内</td></tr></table></td></tr>",
    '<tr><td title="値"', ' class="a"><pre>  x', '    y</pre></td></tr></tbody><tfoot><tr><td>末尾</td></tr></tfoot></table>');
  const expected = lines("<table>", "<caption>題</caption>", "<colgroup>", "<col>", "</colgroup>", "<tbody>", "<tr>", "<td>", "", "本文", "",
    "</td>", "</tr>", "<tr>", "<td><!--mdfmt-gap-->", "  <table>", "    <tr>", "      <td>内</td>", "    </tr>", "  </table>",
    "</td>", "</tr>", "<tr>", '<td title="値" class="a">', "  <pre>  x", "    y</pre>", "</td>", "</tr>", "</tbody>", "<tfoot>",
    "<tr>", "<td>末尾</td>", "</tr>", "</tfoot>", "</table>");
  await assertFormats(options, input, expected, "最も近い table と、pre の継続行");
});

test("まとまりの間の Markdown と種類 1〜5 の HTML のタグは、対の数え方に含めない", async (t) => {
  const options = await project(t);
  const fence = String.fromCharCode(96).repeat(3);
  const between = lines("段落の <i>文</i>。", "", fence + "html", "</div>", fence, "", "<!-- </div> -->", "", "<pre>", "</div>", "</pre>");
  const input = lines("<div><p>開き</p>") + "\n" + between + "\n" + lines("<p>閉じ</p></div>");
  const expected = lines("<div>", "  <p>開き</p>") + "\n" + between + "\n" + lines("<p>閉じ</p>", "</div>");
  await assertFormats(options, input, expected, "間のノードは触らない");
});

test("対象にできない断片を含むまとまりは、ほかの断片も変えない", async (t) => {
  const options = await project(t);
  const unchanged = [
    ["途中の断片のタブ", lines("> <details><summary>概要</summary>", ">", "> 本文", ">", ">\t<div><p>中</p></div>", ">", "> </details>")],
    ["途中の断片の接頭辞がそろわない", lines("> <details><summary>概要</summary>", ">", "> 本文", ">", "> <div>", "> <p>中</p>",
      "></div>", ">", "> </details>")],
  ];
  for (const [name, input] of unchanged) await assertFormats(options, input, input, name);
});

test("まとまりの目印が失われる結果と、空の断片や空行ができる結果は当てる前に拒む", async (t) => {
  const options = await project(t);
  const input = lines("<details><summary>概要</summary>", "", "本文", "", "</details>");
  const marker = "<!--mdfmt-gap-->";
  const breaking = [
    ["目印を消す", (text) => text.replace(marker, "")],
    ["目印を単独行にしない", (text) => text.replace("\n" + marker + "\n", marker)],
    ["空の断片を作る", (text) => text.replace(marker, marker + "\n" + marker)],
    ["断片の中に空行を足す", (text) => text.replace("><summary>", ">\n\n<summary>")],
  ];
  for (const [name, beautifyHtml] of breaking) {
    const stats = {};
    await assertFormats({ ...options, beautifyHtml, stats }, input, input, name);
    assert.equal(stats.renders, 0, name + ": 当てる前に外す");
  }
});

test("同じ断片で閉じる表は、断片の先頭でも表の中の字下げを保つ", async (t) => {
  const options = await project(t);
  await assertFormats(options,
    lines("<details>", "<summary>概要</summary>", "", "本文", "", "<table><tr><td>a</td><td>b</td></tr></table>", "", "</details>"),
    lines("<details>", "  <summary>概要</summary>", "", "本文", "", "<table>", "  <tr>", "    <td>a</td>", "    <td>b</td>",
      "  </tr>", "</table>", "", "</details>"), "details の中の閉じた表");
  await assertFormats(options,
    lines("<table>", "<tr>", "<td>", "", "- 本文", "", "<table><tr><td>内</td></tr></table>", "</td>", "</tr>", "</table>"),
    lines("<table>", "<tr>", "<td>", "", "- 本文", "", "<table>", "  <tr>", "    <td>内</td>", "  </tr>", "</table>",
      "</td>", "</tr>", "</table>"), "外の表だけが Markdown をはさむ");
});

test("生の文字の中の table で表の文脈を持ち越さず、表の外の空白が変わる結果を拒む", async (t) => {
  const options = await project(t);
  const input = lines("<div>", "<script>", 'var s = "<table>";', "</script>", "</div>", "", "<tr><td>a</td><i>b</i></tr>");
  const expected = lines("<div>", "  <script>", 'var s = "<table>";', "</script>", "</div>", "", "<tr><td>a</td><i>b</i></tr>");
  const beautifyHtml = (text, settings) => text.startsWith("<tr>")
    ? text.replace("</td><i>", "</td>\n<i>") : runtimeRequire("js-beautify").html(text, settings);
  await assertFormats({ ...options, beautifyHtml }, input, expected, "安全な script の字下げだけを当てる");
  const stats = {};
  // script の字下げが済んだ文書では、表の外の改行だけが候補になり、解析して拒む。
  await assertFormats({ ...options, beautifyHtml, stats }, expected, expected, "表の外のブロックは原文のまま");
  assert.ok(stats.parses >= 2, "当てた文書を解析した");
  assert.ok(stats.renders > 0, "描画を比べて拒んだ");
});

test("複数行トークンと white-space の要素の中で始まる行の字下げを保つ", async (t) => {
  const options = await project(t);
  await assertFormats(options,
    lines("<table><tr><td>", "", "本文", "", "</td><td><!--", "  注記", "--></td></tr></table>"),
    lines("<table>", "<tr>", "<td>", "", "本文", "", "</td>", "<td><!--", "  注記", "--></td>", "</tr>", "</table>"),
    "複数行コメントの 2 行目以降は変えない");
  await assertFormats(options,
    lines("<table><tr><td>", "", "本文", "", '</td><td title="一行目', '  二行目">値</td></tr></table>'),
    lines("<table>", "<tr>", "<td>", "", "本文", "", "</td>", '<td title="一行目', '  二行目">値</td>', "</tr>", "</table>"),
    "属性の値の改行の後は変えない");
  await assertFormats(options,
    lines("<table><tr><td>", "", "本文", "", '</td><td><div style="white-space: pre">x', "        y</div></td></tr></table>"),
    lines("<table>", "<tr>", "<td>", "", "本文", "", "</td>", "<td>", '  <div style="white-space: pre">x',
      "        y</div>", "</td>", "</tr>", "</table>"), "white-space の 2 行目の字下げは 8 つのまま保つ");
  const styled = lines("<table><tr><td>", "", "本文", "", '</td><td><div style="white-space: pre">  x',
    "    y</div></td></tr></table>");
  // js-beautify が white-space の本文を変えるため、この例は描画の確かめでまとまりごと拒む。
  await assertFormats(options, styled, styled, "white-space の描画が変わるまとまりは原文のまま");
});

test("閉じない最初の断片を見送って、後ろのブロックとまとまりを整形する", async (t) => {
  const options = await project(t);
  const opening = lines("<p>閉じない", "", "本文", "");
  await assertFormats(options, opening + lines("<table><tr><td>a</td></tr></table>"),
    opening + lines("<table>", "  <tr>", "    <td>a</td>", "  </tr>", "</table>"), "後ろの閉じた表");
  await assertFormats(options, opening + lines("<details><summary>概要</summary>", "", "本文", "", "</details>"),
    opening + lines("<details>", "  <summary>概要</summary>", "", "本文", "", "</details>"), "後ろの独立したまとまり");
});

test("GFM でも Markdown のセルをはさむ表の caption と thead をそろえる", async (t) => {
  const options = { ...await project(t), flavor: "gfm" };
  const input = lines("<table><caption>題</caption><thead><tr><th>見出し</th></tr></thead><tbody><tr><td>",
    "", "- セルの本文", "", "</td></tr></tbody></table>");
  const expected = lines("<table>", "<caption>題</caption>", "<thead>", "<tr>", "<th>見出し</th>", "</tr>", "</thead>", "<tbody>", "<tr>", "<td>",
    "", "- セルの本文", "", "</td>", "</tr>", "</tbody>", "</table>");
  await assertFormats(options, input, expected, "GFM の表");
});

test("HTML の正規化は開始時の表の深さを使い、生の文字の中のタグでは深さを変えない", () => {
  assert.equal(normalizedHtml("</td></tr>", undefined, 1), normalizedHtml("</td>\n</tr>", undefined, 1));
  assert.notEqual(normalizedHtml("</td></tr>", undefined, 0), normalizedHtml("</td>\n</tr>", undefined, 0));
  for (const name of ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]) {
    const opening = "<" + name + '>"<table>"</' + name + ">";
    assert.notEqual(normalizedHtml(opening + "</td></tr>"), normalizedHtml(opening + "</td>\n</tr>"), name + ": 開きは数えない");
    const closing = "<" + name + '>"</table>"</' + name + ">";
    // plaintext は閉じタグでも終わらないので、後ろの改行も生の文字として保つ。
    if (name === "plaintext") {
      assert.notEqual(normalizedHtml(closing + "</td></tr>", undefined, 1),
        normalizedHtml(closing + "</td>\n</tr>", undefined, 1), "plaintext は閉じず、後ろの空白も保つ");
    } else {
      assert.equal(normalizedHtml(closing + "</td></tr>", undefined, 1),
        normalizedHtml(closing + "</td>\n</tr>", undefined, 1), name + ": 閉じも数えない");
    }
  }
  assert.notEqual(normalizedHtml("a  b</xmp><p>x</p>", undefined, 0, "xmp"),
    normalizedHtml("a b</xmp><p>x</p>", undefined, 0, "xmp"), "開始時の xmp の中の空白を保つ");
  assert.equal(normalizedHtml("a</xmp><div><p>x</p></div>", undefined, 0, "xmp"),
    normalizedHtml("a</xmp><div>\n  <p>x</p>\n</div>", undefined, 0, "xmp"), "開始時の xmp を閉じた後の字下げは畳む");
});

test("生の文字の閉じタグは ASCII の境と壊れていない形で見分ける", () => {
  for (const tail of ["\t>", "\n>", "\f>", "\r>", " >", "/>", ">"]) {
    assert.equal(normalizedHtml("<xmp>a</XmP" + tail + " a  b"),
      normalizedHtml("<xmp>a</XmP" + tail + " a b"), "閉じタグの境: " + JSON.stringify(tail));
  }
  assert.equal(normalizedHtml('<xmp>a</xmp foo="bar">  b'),
    normalizedHtml('<xmp>a</xmp foo="bar"> b'), "属性付きの閉じタグの後ろの空白は畳む");
  assert.notEqual(normalizedHtml('<xmp>a</xmp foo="</xmp>  b'),
    normalizedHtml('<xmp>a</xmp foo="</xmp> b'), "壊れた閉じタグの候補から文書の終わりまでを生の文字にする");
});

test("見送った未閉じの要素を閉じる後ろのブロックとまとまりは変えない", async (t) => {
  const options = await project(t);
  const opening = lines("<details><summary>概要</summary>", "<table>", "", "- 本文", "");
  const unchanged = [
    ["後ろの 1 ブロックが table を閉じる", opening + lines("<tr><td>a</td><td>b</td></tr>", "</table>")],
    ["後ろのまとまりが table を閉じる", opening + lines("<tbody><tr><td>", "", "本文", "", "</td></tr></tbody></table>")],
  ];
  for (const [name, input] of unchanged) await assertFormats(options, input, input, name);
  const input = unchanged[0][1];
  await assertFormats(options, input + "\n" + lines("<div><p>独立</p></div>"),
    input + "\n" + lines("<div>", "  <p>独立</p>", "</div>"), "対応の無い後ろのブロックは整形できる");
});

test("まとまりの外の table に属する表の部品だけのまとまりは変えない", async (t) => {
  const options = await project(t);
  const input = lines("<table>", "", "本文", "", "<tbody>", "<tr><td>a</td><td>", "", "- セル", "", "</td></tr>", "</tbody>");
  await assertFormats(options, input, input, "閉じない外の table の部品");
});

test("生の文字の中のタグは、まとまりの対や字下げの要素として読まない", async (t) => {
  const options = await project(t);
  await assertFormats(options,
    lines("<details>", "<summary>概要</summary>", "", "本文", "", '<div><script>const s = "</details>";</script></div>', "</details>"),
    lines("<details>", "  <summary>概要</summary>", "", "本文", "", "<div>", '  <script>const s = "</details>";</script>',
      "</div>", "</details>"), "script の文字列中の閉じタグ");
  // /> の / が無視されることを確かめる。本文の整形は差し替えず、summary の字下げだけを候補にする。
  const beautifyHtml = (text) => text.replace("\n<summary>", "\n  <summary>");
  for (const name of ["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]) {
    const raw = '<div><' + name + '/>"</details><tr>"</' + name + '></div>';
    await assertFormats({ ...options, beautifyHtml },
      lines("<details>", "<summary>概要</summary>", "", "本文", "", raw, "</details>"),
      lines("<details>", "  <summary>概要</summary>", "", "本文", "", raw, "</details>"), name + " の / は空要素にしない");
  }
  const plaintext = lines("<details>", "<summary>概要</summary>", "", "本文", "", '<div><plaintext/>"</details>"</plaintext></div>', "</details>");
  await assertFormats({ ...options, beautifyHtml }, plaintext, plaintext, "plaintext は閉じタグでも終わらない");
  const unclosedPlaintext = lines("<div><plaintext>", "", "本文", "", "<div><p>a</p></div>");
  await assertFormats(options, unclosedPlaintext, unclosedPlaintext, "生の文字の中の後続ブロックは単独でも変えない");
  // htmlGroupPaths は生の文字の中で始まる行の字下げを変えず、比べ方も xmp の中の空白の違いを見分ける。
  await assertFormats(options,
    lines("<table><tr><td>", "", "本文", "", "</td><td><xmp>x", "        y</xmp></td></tr></table>"),
    lines("<table>", "<tr>", "<td>", "", "本文", "", "</td>", "<td>", "  <xmp>x", "        y</xmp>", "</td>", "</tr>", "</table>"),
    "xmp の 2 行目の字下げは変えない");
});

test("生の文字や空要素でない要素の空白を変える整形は当てない", async (t) => {
  const options = await project(t);
  const unchanged = [
    ["xmp の中のタグに似た文字", lines("<xmp>", "<div><p>本文</p></div>", "</xmp>")],
    ["div の中の xmp の文字", lines("<div><xmp>", "<div><p>本文</p></div>", "</xmp></div>")],
    ["iframe の中の閉じタグに似た文字", lines('<div style="white-space: pre"><iframe></div></iframe>hello   world</div>')],
    ["span の / は空要素にしない", lines('<div><span style="white-space: pre"/>a   b</span></div>')],
    ["noscript の中の white-space", lines("<noscript>", '<div style="white-space: pre">a   b</div>', "</noscript>")],
    ["noscript の中のタグが後ろの空白の扱いを変える", lines('<div><noscript><b style="white-space: pre"></noscript>a   b</div>')],
  ];
  for (const [name, input] of unchanged) await assertFormats(options, input, input, name);
});

test("空要素の white-space は後ろの HTML の整形を止めない", async (t) => {
  const options = await project(t);
  await assertFormats(options,
    lines('<p><img src="a.png" style="white-space: pre"></p>', "", "<div><p>後ろ</p></div>"),
    lines('<p><img src="a.png" style="white-space: pre"></p>', "", "<div>", "  <p>後ろ</p>", "</div>"),
    "img の white-space の後ろのブロック");
});

test("外の table の文脈をリストの項目の HTML に渡して、描画を保って整形する", async (t) => {
  const options = await project(t);
  await assertFormats(options,
    lines("<table><tr><td>", "", "- 項目", "", "  <tr><td>a</td><td>b</td></tr>", "", "</td></tr></table>"),
    lines("<table>", "<tr>", "<td>", "", "- 項目", "", "  <tr>", "    <td>a</td>", "    <td>b</td>", "  </tr>", "", "</td>", "</tr>", "</table>"),
    "項目の中の表の部品の行分け");
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
    ["<table><td> a </td></table>", "<table><td>a</td></table>"],
    ["<p>a\n  b</p>", "<p>a b</p>"],
    ["a<br>\n b", "a<br>b"],
    ['<td colspan = "2"  align="right" >x</td>', '<td colspan="2" align="right">x</td>'],
    ["<div><!-- c --><p>x</p></div>", "<div><!-- c -->\n  <p>x</p>\n</div>"],
    ["<details>\n<summary>概要</summary>\n", "<details>\n  <summary>概要</summary>\n"],
    ['<img src="a.png" style="white-space: pre"><div><p>x</p></div>',
      '<img src="a.png" style="white-space: pre"><div>\n  <p>x</p>\n</div>'],
    ['<br style="white-space: pre"><p>a\n  b</p>', '<br style="white-space: pre"><p>a b</p>'],
    ["<title>a  b</title>", "<title>a b</title>"],
    // 二重のエスケープも --> で終わり、その後の閉じタグで script と div を閉じる。
    ['<div style="white-space: pre"><script><!--<script>--></script></div>a   b',
      '<div style="white-space: pre"><script><!--<script>--></script></div>a b'],
    // コメントに似た文字があっても xmp は閉じ、後ろの通常の文字の空白を畳む。
    ["<xmp><!--</xmp>-->  a  b", "<xmp><!--</xmp>--> a b"],
  ];
  for (const [a, b] of same) assert.equal(normalizedHtml(a), normalizedHtml(b), `${a} と ${b} は同じ描画`);
  const different = [
    ["<b>a</b><i>b</i>", "<b>a</b> <i>b</i>"],
    ["<pre>  x</pre>", "<pre>x</pre>"],
    ["<code>a  b</code>", "<code>a b</code>"],
    ["<script>a  b</script>", "<script>a b</script>"],
    ["<style>a  b</style>", "<style>a b</style>"],
    ['<div style="white-space: pre">a  b</div>', '<div style="white-space: pre">a b</div>'],
    ["<pre><pre>a  </pre>  b</pre>", "<pre><pre>a  </pre> b</pre>"],
    ['<td title="a  b">x</td>', '<td title="a b">x</td>'],
    ["<!-- a  b -->", "<!-- a b -->"],
    ["<p>本文</p>", "<p>本 文</p>"],
    // 表の外の表の部品のタグと、空要素の閉じタグは、HTML の解析で捨てられるので、前後の空白が描画に出る。
    ["<div><td><b>a</b></td><i>b</i></div>", "<div><td><b>a</b></td>\n<i>b</i></div>"],
    ["<div><tr>a</tr> <i>b</i></div>", "<div><tr>a</tr><i>b</i></div>"],
    ["<hr>x</hr><i>y</i>", "<hr>x</hr> <i>y</i>"],
    // 生の文字の要素の中のタグに似た文字は文字。xmp・plaintext・textarea は中の空白をそのまま描く。
    ["<xmp>\n<div><p>本文</p></div>\n</xmp>", "<xmp>\n<div>\n  <p>本文</p>\n</div>\n</xmp>"],
    ['<div style="white-space: pre"><iframe></div></iframe>hello   world</div>',
      '<div style="white-space: pre"><iframe></div></iframe>hello world</div>'],
    ["<plaintext><div><p>a</p></div>", "<plaintext><div>\n  <p>a</p>\n</div>"],
    ["<textarea><b  >x</b></textarea>", "<textarea><b>x</b></textarea>"],
    // xmp の閉じタグはコメントに似た文字に隠れず、pre の残りの空白を保つ。
    ["<pre><xmp><!--</xmp>--> a</pre>", "<pre><xmp><!--</xmp>-->  a</pre>"],
    // script の二重のエスケープの中の </script> は閉じず、周りの要素の閉じタグも文字として読む。
    ['<div style="white-space: pre"><script><!--<script></script></div></script>hello   world</div>',
      '<div style="white-space: pre"><script><!--<script></script></div></script>hello world</div>'],
    ["<pre><script><!--<script></script></pre></script>a   b</pre>",
      "<pre><script><!--<script></script></pre></script>a b</pre>"],
    // 空要素でない要素の / は無視され、要素は開く。
    ['<span style="white-space: pre"/>a   b</span>', '<span style="white-space: pre"/>a b</span>'],
    ['<span style="white-space: pre"><span/>x</span>a   b</span>',
      '<span style="white-space: pre"><span/>x</span>a b</span>'],
    ["<xmp>a</xmp\u00a0>  b</xmp>", "<xmp>a</xmp\u00a0> b</xmp>"],
    // noscript (\u30b9\u30af\u30ea\u30d7\u30c8\u3092\u5207\u3063\u305f\u3068\u304d) \u3068\u3001svg\u30fbmath \u306e\u4e2d\u306e\u540c\u3058\u540d\u524d\u306e\u8981\u7d20\u3067\u306f\u3001\u4e2d\u306e\u30bf\u30b0\u3082\u8981\u7d20\u306b\u306a\u308b\u3002
    ['<noscript><div style="white-space: pre">a   b</div></noscript>',
      '<noscript><div style="white-space: pre">a b</div></noscript>'],
    ['<svg><title></svg><div style="white-space: pre">a   b</div></title></svg>',
      '<svg><title></svg><div style="white-space: pre">a b</div></title></svg>'],
    ["<math><textarea></math><pre>a   b</pre></textarea></math>",
      "<math><textarea></math><pre>a b</pre></textarea></math>"],
    // svg・math の中では、空要素の名前の要素も中を持ちうる。
    ['<math><link style="white-space: pre"><mtext>a   b</mtext></link></math>',
      '<math><link style="white-space: pre"><mtext>a b</mtext></link></math>'],
  ];
  for (const [a, b] of different) assert.notEqual(normalizedHtml(a), normalizedHtml(b), `${a} と ${b} は別の描画`);
});
