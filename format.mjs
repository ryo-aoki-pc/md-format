#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const runtimes = new Map();
const MAX_PASSES = 16;
const MAX_FIXES = 4096;

const parserOptions = {
  extension: {
    descriptionLists: true,
    table: true,
    strikethrough: true,
    autolink: true,
    tasklist: true,
    footnotes: true,
    multilineBlockQuotes: true,
    mathDollars: true,
    mathCode: true,
    alerts: true,
  },
  parse: { relaxedTasklistMatching: true, leaveFootnoteDefinitions: true },
};

const containers = new Set([
  "List", "Item", "TaskItem", "BlockQuote", "MultilineBlockQuote",
  "DescriptionList", "DescriptionItem", "DescriptionDetails", "DescriptionTerm",
  "FootnoteDefinition", "Table", "TableRow", "TableCell",
]);
const literalNodes = new Set([
  "Code", "CodeBlock", "Math", "HtmlBlock", "HtmlInline", "Raw",
  "MultilineBlockQuote", "FootnoteDefinition", "FootnoteReference", "TaskItem",
]);
const literalSpanTypes = new Set(["Code", "CodeBlock", "Math", "HtmlBlock", "HtmlInline"]);
const indentRules = new Set(["MD005", "MD007"]);

// 整形で直す修正の分類。名前は CLI の --enable-fixes / --disable-fixes (Neovim では LazyVimStarter の format_fixes) で使う。
// ルールごとの例は docs/reference/rules.md にある。
export const fixCategories = Object.freeze({
  heading_spacing: ["MD019", "MD021", "MD023"],
  heading_conversion: ["MD018", "MD020"],
  heading_punctuation: ["MD026"],
  whitespace: ["MD009", "MD010", "MD047"],
  blank_lines: ["MD012", "MD022", "MD031", "MD032", "MD058"],
  lists: ["MD004", "MD005", "MD007", "MD029", "MD030"],
  blockquotes: ["MD027"],
  emphasis_style: ["MD049", "MD050"],
  emphasis_spaces: ["MD037"],
  code: ["MD014", "MD038"],
  link_style: ["MD034", "MD054"],
  link_text: ["MD039"],
  link_fragments: ["MD051"],
  reversed_links: ["MD011"],
  unused_definitions: ["MD053"],
  tables: ["MD060"],
  proper_names: ["MD044"],
});
// 既定では直さない分類 (見出し・強調・リンクを作る修正と、本文の行を消す修正)。
export const defaultDisabledCategories = Object.freeze(["heading_conversion", "emphasis_spaces", "reversed_links", "unused_definitions"]);
// HTML のブロックの整形 (markdownlint の修正ではない分類)。既定で有効。
export const htmlCategory = "html";
// loose のリストを詰めて tight にする (markdownlint の修正ではない分類)。既定で有効。
export const tightListsCategory = "tight_lists";
// 中の空白がそのまま描画に出る要素。整形でも中身を変えず、描画の比較でも原文のまま比べる。
const whitespaceElements = Object.freeze(["pre", "textarea", "script", "style", "code", "kbd", "samp"]);
// 前後の空白が描画に出ない要素 (ブロック要素・表の要素・<br>)。描画の比較では、このタグに接する空白を比べない。
const blockElements = new Set([
  "address", "article", "aside", "blockquote", "body", "br", "caption", "center", "col", "colgroup", "dd", "details",
  "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "head", "header", "hgroup", "hr", "html", "legend", "li", "main", "menu", "nav", "ol", "optgroup", "option", "p",
  "pre", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "ul",
]);
// js-beautify の設定。字下げは 2 つで、折り返さず、空行を足さない (HTML のブロックは空行で終わるため)。
// テンプレートの記法 ({{ }} など) は解釈しない。
const beautifyOptions = Object.freeze({
  indent_size: 2,
  indent_char: " ",
  eol: "\n",
  end_with_newline: false,
  preserve_newlines: true,
  wrap_line_length: 0,
  extra_liners: [],
  templating: ["none"],
  indent_scripts: "keep",
});
// markdownlint 0.41.1 の組み込みルールの別名。fixCategories に無いルールは自動修正を持たない (診断だけ)。
// ここに無い組み込みルール (markdownlint を上げて増えたもの) の修正は、確かめて表に足すまで当てない。
const ruleAliases = {
  MD001: ["heading-increment"], MD003: ["heading-style"], MD004: ["ul-style"], MD005: ["list-indent"],
  MD007: ["ul-indent"], MD009: ["no-trailing-spaces"], MD010: ["no-hard-tabs"], MD011: ["no-reversed-links"],
  MD012: ["no-multiple-blanks"], MD013: ["line-length"], MD014: ["commands-show-output"],
  MD018: ["no-missing-space-atx"], MD019: ["no-multiple-space-atx"], MD020: ["no-missing-space-closed-atx"],
  MD021: ["no-multiple-space-closed-atx"], MD022: ["blanks-around-headings"], MD023: ["heading-start-left"],
  MD024: ["no-duplicate-heading"], MD025: ["single-title", "single-h1"], MD026: ["no-trailing-punctuation"],
  MD027: ["no-multiple-space-blockquote"], MD028: ["no-blanks-blockquote"], MD029: ["ol-prefix"],
  MD030: ["list-marker-space"], MD031: ["blanks-around-fences"], MD032: ["blanks-around-lists"],
  MD033: ["no-inline-html"], MD034: ["no-bare-urls"], MD035: ["hr-style"], MD036: ["no-emphasis-as-heading"],
  MD037: ["no-space-in-emphasis"], MD038: ["no-space-in-code"], MD039: ["no-space-in-links"],
  MD040: ["fenced-code-language"], MD041: ["first-line-heading", "first-line-h1"], MD042: ["no-empty-links"],
  MD043: ["required-headings"], MD044: ["proper-names"], MD045: ["no-alt-text"], MD046: ["code-block-style"],
  MD047: ["single-trailing-newline"], MD048: ["code-fence-style"], MD049: ["emphasis-style"],
  MD050: ["strong-style"], MD051: ["link-fragments"], MD052: ["reference-links-images"],
  MD053: ["link-image-reference-definitions"], MD054: ["link-image-style"], MD055: ["table-pipe-style"],
  MD056: ["table-column-count"], MD058: ["blanks-around-tables"], MD059: ["descriptive-link-text"],
  MD060: ["table-column-style"],
};
export const builtinRuleNames = Object.freeze(Object.fromEntries(
  Object.entries(ruleAliases).map(([id, aliases]) => [id, Object.freeze([id, ...aliases])])));
const ruleCategories = new Map(Object.entries(fixCategories).flatMap(([category, ids]) => ids.map((id) => [id, category])));
const ruleIdsByAlias = new Map(Object.entries(ruleAliases).flatMap(([id, aliases]) => aliases.map((alias) => [alias, id])));
// 見出し・強調・リンクを作ることが目的の修正。構文木の比較では正しい修正と見分けられないので、緩い検査だけで当てる。
const creatingRules = new Set(["MD011", "MD018", "MD020", "MD037"]);
const headingConversionRules = new Set(["MD018", "MD020"]);
// 変えてよい差を限って構文木を比べる修正。その差だけを両方の木から消してから比べる。
const limitedRules = {
  // 見出しの末尾の句読点。
  MD026: (node) => (node[0] === "Heading" ? [node[0], node[1], editText(node[2], node[2].length - 1, (text) => text.replace(/[\p{P}\p{S}\s]+$/u, ""))] : node),
  // リンクの文字の端の ASCII の空白 (全角空白は比べる)。
  MD039: (node) => {
    if (node[0] !== "Link" && node[0] !== "Image") return node;
    const leading = editText(node[2], 0, (text) => text.replace(/^[ \t\r\n]+/u, ""));
    return [node[0], node[1], editText(leading, leading.length - 1, (text) => text.replace(/[ \t\r\n]+$/u, ""))];
  },
  // 文字の大文字小文字。
  MD044: (node) => (node[0] === "Text" ? ["Text", node[1].toLowerCase(), []] : node),
  // 同じ文書の見出しへのリンクの断片の大文字小文字。
  MD051: (node) => (node[0] === "Link" && node[1].url.startsWith("#") ? [node[0], { ...node[1], url: node[1].url.toLowerCase() }, node[2]] : node),
};
// Comrak に専用ノードが無い GitLab の記法。原文と出現順を変える修正は当てない。
// GitLab は [[_toc_]] のような小文字の目次も目次として描くので、大文字小文字を区別しない。
// 広めに当たっても検査が厳しくなるだけなので、参照は GitLab の規則より緩く拾う。
const gitlabAtoms = new RegExp([
  // 目次 [[_TOC_]] と、wiki のページへのリンク [[ページ]] (中の _ を * にすると別のページ名になる)。
  String.raw`\[\[[^\]\r\n]+\]\]`, String.raw`\[TOC\]`, String.raw`\[~\]`, String.raw`\[\^[^\]\r\n]+\](?::)?`,
  // include は行頭から書いたときだけ働くので、行頭の字下げごと守る。
  String.raw`^[ \t]*::include\{[^\r\n]*?\}`, String.raw`::include\{[^\r\n]*?\}`,
  String.raw`\{[+-][^\r\n]*?[+-]\}`, String.raw`\[[+-][^\r\n]*?[+-]\]`,
  // 画像やリンクの直後の幅や高さの指定 (URL に括弧があっても、閉じ括弧と属性の境目で守る)。
  String.raw`[)\]]\{[^}\r\n]*\}`,
  // 課題 #123・マージリクエスト !123・エピック &123・スニペット $123。前に group/project や project が付く形も含める。
  // \ で打ち消した記号は参照にならないので、守らない。
  String.raw`(?<![\w&\\/.-])(?:[\w.-]+(?:\/[\w.-]+)*)?[#!&$]\d+(?:\+s?)?`,
  // ラベル ~label・~"label"・~scope::label、マイルストーン %milestone・%"milestone" (前に project が付く形も)、ユーザー @user。
  // 文末の句点や疑問符は名前に含めない (見出しの末尾の句読点を消す修正を拒まないため)。
  String.raw`(?<![\w~\\/.-])(?:[\w.-]+(?:\/[\w.-]+)*)?~(?:"[^"\r\n]+"|[\p{L}\p{N}_](?:[\p{L}\p{N}_.?&:-]*[\p{L}\p{N}_&-])?)`,
  String.raw`(?<![\w%\\/.-])(?:[\w.-]+(?:\/[\w.-]+)*)?%(?:"[^"\r\n]+"|[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_-])?)`,
  // GitLab のユーザー名は末尾にピリオドを置けないので、文末の句点を参照に含めない。
  String.raw`(?<![\w.+@\\-])@[\p{L}\p{N}_](?:[\p{L}\p{N}_.-]*[\p{L}\p{N}_-])?`,
  // [issue:123] のような、種類を書いた参照 ([https://…] のような URL は除く)。
  String.raw`\[[a-z_]+:(?!\/)[^\]\r\n]+\]`,
].join("|"), "gimu");

async function runtime(directory) {
  const resolved = path.resolve(directory);
  if (!runtimes.has(resolved)) {
    runtimes.set(resolved, (async () => {
      const require = createRequire(path.join(resolved, "package.json"));
      const { main } = await import(pathToFileURL(require.resolve("markdownlint-cli2")));
      const { parseMarkdown, markdownToHTML } = require("comrak");
      if (typeof main !== "function" || typeof parseMarkdown !== "function" || typeof markdownToHTML !== "function") {
        throw new Error("整形ツールの依存パッケージを読み込めません。");
      }
      return { main, parseMarkdown, markdownToHTML };
    })().catch((error) => {
      runtimes.delete(resolved);
      throw error;
    }));
  }
  return runtimes.get(resolved);
}

// HTML のブロックの整形器 (js-beautify)。整形するブロックがあるときだけ読む (HTML の無い文書は、依存を入れ直す前でも整形できる)。
// 読めなかったことは覚えない (後から導入し直したら、次の要求で読む)。
const beautifiers = new Map();

function htmlBeautifier(directory) {
  const resolved = path.resolve(directory);
  if (!beautifiers.has(resolved)) {
    let html;
    try {
      ({ html } = createRequire(path.join(resolved, "package.json"))("js-beautify"));
    } catch (error) {
      throw new Error("HTML の整形器 (js-beautify) を読み込めません。md-format の導入スクリプト (scripts/setup.mjs) を実行し直してください。", { cause: error });
    }
    if (typeof html !== "function") {
      throw new Error("HTML の整形器 (js-beautify) を読み込めません。md-format の導入スクリプト (scripts/setup.mjs) を実行し直してください。");
    }
    beautifiers.set(resolved, html);
  }
  return beautifiers.get(resolved);
}

// 1 回の解析の結果から何度も求める値は、ノードと解析の結果に覚えさせる (同じ結果を何度もたどらない)。
const typeKey = Symbol("type");
const ordinalCache = new WeakMap();
const canonicalCache = new WeakMap();

function nodeType(node) {
  if (node[typeKey] !== undefined) return node[typeKey];
  const value = node.data.value;
  return (node[typeKey] = typeof value === "string" ? value : Object.keys(value)[0]);
}

// 各ノードの「同じ型の前の兄弟の数」。親ごとに子を左から一度だけ数える。
function siblingOrdinals(nodes) {
  if (ordinalCache.has(nodes)) return ordinalCache.get(nodes);
  const ordinals = new Array(nodes.length).fill(0);
  for (let index = 0; index < nodes.length; index++) {
    const counts = new Map();
    for (let child = nodes[index].first_child; child !== undefined; child = nodes[child].next_sibling) {
      const type = nodeType(nodes[child]);
      ordinals[child] = counts.get(type) || 0;
      counts.set(type, ordinals[child] + 1);
    }
  }
  ordinalCache.set(nodes, ordinals);
  return ordinals;
}

function nodeValue(node) {
  const type = nodeType(node);
  const value = typeof node.data.value === "string" ? null : node.data.value[type];
  // 位置やマーカーの表記は比較せず、表示内容と構造に関わる値だけを残す。
  if (type === "List" || type === "Item") {
    return {
      list_type: value.list_type,
      ...(type === "List" ? { start: value.start } : {}),
      tight: value.tight,
      is_task_list: value.is_task_list,
    };
  }
  if (type === "DescriptionItem") return { tight: value.tight };
  if (type === "CodeBlock") return { literal: value.literal, info: value.info };
  if (type === "Code") return { literal: value.literal };
  if (type === "Heading") return { level: value.level };
  if (type === "Link" || type === "Image") return { url: value.url, title: value.title };
  if (type === "Table") return { alignments: value.alignments };
  if (type === "Alert") return { alert_type: value.alert_type, title: value.title ?? null, multiline: value.multiline };
  if (type === "MultilineBlockQuote") return null;
  if (type === "FootnoteDefinition" || type === "FootnoteReference") return { name: value.name };
  return value;
}

function editText(children, index, edit) {
  if (children[index]?.[0] !== "Text") return children;
  const text = edit(children[index][1]);
  const edited = [...children];
  if (text) edited[index] = ["Text", text, []];
  else edited.splice(index, 1);
  return edited;
}

function mapTree(tree, change) {
  const [type, value, children] = change(tree);
  return [type, value, children.map((child) => mapTree(child, change))];
}

function childIndices(nodes, index) {
  const children = [];
  for (let child = nodes[index].first_child; child !== undefined; child = nodes[child].next_sibling) {
    children.push(child);
  }
  return children;
}

// 表示に関わる構造の木。隣り合う Text と SoftBreak は 1 つの文字列にし、HTML で同じに見える
// ASCII の空白・タブ・改行の並びだけを空白 1 つに畳む。全角空白や NBSP は畳まず、要素の端の空白も残す。
// 部分木は説明リスト・リテラル・文書全体の比較で何度も作るので、解析の結果ごとに覚える (作った配列は変えない)。
function canonicalNode(nodes, index) {
  let memo = canonicalCache.get(nodes);
  if (!memo) canonicalCache.set(nodes, (memo = new Array(nodes.length)));
  return (memo[index] ??= buildCanonicalNode(nodes, index));
}

function buildCanonicalNode(nodes, index) {
  const children = [];
  let text = null;
  const flush = () => {
    if (text !== null) children.push(["Text", text.replace(/[ \t\r\n]+/gu, " "), []]);
    text = null;
  };
  for (const child of childIndices(nodes, index)) {
    const type = nodeType(nodes[child]);
    if (type === "Text" || type === "SoftBreak") {
      text = (text ?? "") + (type === "Text" ? nodes[child].data.value.Text : "\n");
    } else {
      flush();
      children.push(canonicalNode(nodes, child));
    }
  }
  flush();
  return [nodeType(nodes[index]), nodeValue(nodes[index]), children];
}

function containerPath(nodes, index) {
  const result = [];
  for (let parent = nodes[index].parent; parent !== undefined; parent = nodes[parent].parent) {
    const type = nodeType(nodes[parent]);
    if (!containers.has(type)) continue;
    result.push([type, nodeValue(nodes[parent]), siblingOrdinals(nodes)[parent]]);
  }
  return result.reverse();
}

function linesOf(source) {
  const lines = [];
  const expression = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
  for (const match of source.matchAll(expression)) {
    lines.push({ start: match.index, content: match[1], ending: match[2] });
  }
  return lines;
}

function frontMatter(source, lines) {
  const opening = /^(---|\+\+\+|;;;)[\w.+-]*[ \t]*$/u.exec(lines[0]?.content.replace(/^\uFEFF/u, "") || "");
  if (!opening) return null;
  for (let line = 1; line < lines.length; line++) {
    if (lines[line].content.trimEnd() === opening[1]) {
      const end = lines[line].start + lines[line].content.length + lines[line].ending.length;
      return { end, raw: source.slice(0, end) };
    }
  }
  return null;
}

// 解析に渡す文字列。front matter は行を保ったまま空白に伏せ、メタデータ中の見本を説明リストとして解析しない。
// 閉じていない区切りは本文扱い。projection と semanticSnapshot が同じ文字列を渡し、解析の結果を共有する。
function parsedText(source, lines) {
  const matter = frontMatter(source, lines);
  return { matter, text: matter ? matter.raw.replace(/[^\r\n]/gu, " ") + source.slice(matter.end) : source };
}

// Comrak の列は UTF-8 のバイト数、JavaScript と fixInfo の列は UTF-16。
function sourceOffset(source, lines, position, inclusive) {
  const line = lines[position.line - 1];
  if (!line) return source.length;
  const bytes = Math.max(0, position.column - (inclusive ? 0 : 1));
  return line.start + Buffer.from(line.content).subarray(0, bytes).toString("utf8").length;
}

function sourceSlice(source, lines, sourcepos) {
  if (!sourcepos?.start.line || !sourcepos?.end.line) return "";
  return source.slice(sourceOffset(source, lines, sourcepos.start, false), sourceOffset(source, lines, sourcepos.end, true));
}

// 整列した区間の中に、[start, end) と重なるもの (end が start と同じなら、start を内側に含むもの) があるか。
// 始まりが limit より前の区間の終わりの最大値と比べる。
function overlapsSpans(spans, start, end) {
  const limit = end > start ? end : start;
  let low = 0;
  let high = spans.starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans.starts[middle] < limit) low = middle + 1;
    else high = middle;
  }
  return low > 0 && spans.maxEnds[low - 1] > start;
}

function sortedSpans(spans) {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const maxEnds = [];
  for (const [, to] of sorted) maxEnds.push(Math.max(to, maxEnds.at(-1) ?? -Infinity));
  return { starts: sorted.map(([from]) => from), maxEnds };
}

function projection(source, parse) {
  const lines = linesOf(source);
  const nodes = parse(parsedText(source, lines).text);
  const replacements = [];
  const blankRequests = [];
  const itemLists = new Map();
  // 見立てた行ごとの、元の行の本来の接頭辞 (見立てた部分より前)。
  const realPrefixes = new Map();
  // コードや数式などの中身と GitLab の記法の範囲。ここに掛かる修正は 1 つずつ確かめる。
  const protectedSpans = [...source.matchAll(gitlabAtoms)].map((match) => [match.index, match.index + match[0].length]);
  const headingRows = new Set();
  // 詰まった (tight) リストの、となり合う項目の間と、1 つの項目の中のとなり合うブロックの間の、下の側の行。
  // この行の前に空行を足すと、リストが loose になる。
  const tightBoundaryRows = new Set();
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const type = nodeType(node);
    const position = node.data.sourcepos?.start;
    if (!position || !lines[position.line - 1]) continue;
    if (type === "List" && node.data.value.List.tight) {
      const items = childIndices(nodes, index);
      items.forEach((item, at) => {
        for (const child of childIndices(nodes, item).slice(1)) tightBoundaryRows.add(nodes[child].data.sourcepos.start.line);
        if (at > 0) tightBoundaryRows.add(nodes[item].data.sourcepos.start.line);
      });
    }
    const line = lines[position.line - 1];
    // 列 (UTF-16) を使うのは説明とリストの項目だけ。ほかのノードで行を UTF-8 に変換しない。
    const column = type === "DescriptionDetails" || type === "Item" || type === "TaskItem"
      ? Buffer.from(line.content).subarray(0, position.column - 1).toString("utf8").length
      : 0;
    if (literalSpanTypes.has(type) && node.data.sourcepos.end?.line) {
      protectedSpans.push([
        sourceOffset(source, lines, position, false),
        sourceOffset(source, lines, node.data.sourcepos.end, true),
      ]);
    }
    if (type === "Heading") {
      for (let row = position.line; row <= (node.data.sourcepos.end?.line || position.line); row++) headingRows.add(row);
    }
    if (type === "DescriptionDetails" && /[:~]/u.test(line.content[column] || "")) {
      const item = nodes[node.parent]?.data.value.DescriptionItem;
      const marker = /^[:~][ \t]+/u.exec(line.content.slice(column));
      const offset = item?.marker_offset || 0;
      const base = column - offset;
      if (marker && base >= 0 && /^ *$/u.test(line.content.slice(base, column))) {
        const width = offset + marker[0].length;
        // 説明を同じ幅の引用として見せる。架空のリスト階層を作らず sublist の意味を保つ。
        const prefix = "> ".repeat(Math.floor(width / 2)) + (width % 2 ? " " : "");
        replacements.push({ start: line.start + base, width, prefix });
        realPrefixes.set(position.line, { text: line.content.slice(0, base), base });
        for (let row = position.line + 1; row <= node.data.sourcepos.end.line; row++) {
          const continuation = lines[row - 1];
          if (continuation && /^(?:[ \t]*>)*[ \t]*$/u.test(continuation.content)) {
            blankRequests.push({ row, markerRow: position.line, markerEnd: base + width });
          } else if (continuation && continuation.content.length >= base + width &&
              /^ +$/u.test(continuation.content.slice(base, base + width))) {
            replacements.push({ start: continuation.start + base, width, prefix });
            realPrefixes.set(row, { text: continuation.content.slice(0, base), base });
          }
        }
      }
    }
    if ((type === "Item" || type === "TaskItem") && node.parent !== undefined && nodeType(nodes[node.parent]) === "List") {
      itemLists.set(`${position.line}:${column + 1}`, node.parent);
    }
  }
  let projected = source;
  for (const { start, width, prefix } of replacements.sort((a, b) => b.start - a.start)) {
    projected = projected.slice(0, start) + prefix + projected.slice(start + width);
  }
  // 空行も引用の中に置き、段落間の空行で本物の子リストが分裂して見えるのを防ぐ。
  // この行だけ幅が変わるため、空行に対する診断は元の解析結果だけを使う。
  const projectedLines = linesOf(projected);
  const blankPrefixes = new Map();
  for (const { row, markerRow, markerEnd } of blankRequests) {
    const prefix = projectedLines[markerRow - 1].content.slice(0, markerEnd).trimEnd();
    if (prefix.length > (blankPrefixes.get(row)?.length || 0)) blankPrefixes.set(row, prefix);
  }
  const projectedRows = new Set(realPrefixes.keys());
  for (const [row, prefix] of [...blankPrefixes].sort((a, b) => b[0] - a[0])) {
    const original = lines[row - 1];
    projected = projected.slice(0, original.start) + prefix + projected.slice(original.start + original.content.length);
    realPrefixes.set(row, { text: original.content, base: original.content.length });
  }
  return {
    source: projected, lines, itemLists, projectedRows, realPrefixes, protectedSpans: sortedSpans(protectedSpans), headingRows,
    tightBoundaryRows,
    syntheticBlankRows: new Set(blankPrefixes.keys()),
  };
}

// 修正が、ある行の前に空行 (入れ物の > と空白だけの行) を 1 つ足すもの (MD022・MD031・MD032・MD058 の形) なら、その行。
function insertedBlankRow(fix) {
  const [row, column] = fixPosition(fix);
  const { deleteCount, insertText } = fix.fixInfo;
  return column === 1 && !deleteCount && /^[ \t>]*\n$/u.test(insertText || "") ? row : undefined;
}

// 引用に見立てた行では、markdownlint が空行を足すときに見立ての > まで写す。そのまま元の文書に
// 当てると空の引用ができるので、足す行を元の行の本来の接頭辞に戻す。
// MD027 (> の後の空白) も、見立てた部分では説明の字下げを指すだけなので当てない。
function fromProjection(fix, projected) {
  const [row, column] = fixPosition(fix);
  const own = projected.realPrefixes.get(row);
  if (fix.ruleNames[0] === "MD027" && own && column - 1 >= own.base) return null;
  const text = fix.fixInfo.insertText;
  if (!text || !text.includes("\n")) return fix;
  const source = [row - 1, row].find((candidate) => projected.realPrefixes.has(candidate));
  if (source === undefined) return fix;
  const raw = projected.realPrefixes.get(source).text.replace(/[^>]/gu, " ");
  const prefix = fix.ruleNames[0] === "MD031" ? raw.trim() : raw.trimEnd();
  const lines = text.split("\n");
  const insertText = lines.map((line, index) => (index < lines.length - 1 && /^[> \t]*$/u.test(line) ? prefix : line)).join("\n");
  return { ...fix, fixInfo: { ...fix.fixInfo, insertText } };
}

// コードや数式などの中身か、GitLab の記法に掛かる修正か。
function touchesProtected(fix, projected) {
  const [row, column] = fixPosition(fix);
  const line = projected.lines[row - 1];
  if (!line) return false;
  const [start, end] = fixSpan(fix, line);
  return overlapsSpans(projected.protectedSpans, start, end);
}

// 修正が書き換える文字の範囲 (行の削除は改行まで)。
function fixSpan(fix, line) {
  const count = fix.fixInfo.deleteCount || 0;
  const start = count === -1 ? line.start : line.start + fixPosition(fix)[1] - 1;
  const end = count === -1 ? line.start + line.content.length + line.ending.length : start + Math.max(0, count);
  return [start, end];
}

function ruleId(fix) {
  return fix.ruleNames[0].toUpperCase();
}

// 修正の確かめ方。structure は構文木の全体を比べる (変えてよい差の決まったルールは、その差だけを消してから)。
// creating は緩い検査だけ。カスタムルールは本文を変えることもあるので、今までどおり緩い検査だけで当てる。
function fixMode(fix) {
  const id = ruleId(fix);
  return !Object.hasOwn(ruleAliases, id) || creatingRules.has(id) ? "creating" : "structure";
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

// 名前を分類・組み込みルール・カスタムルールのどれかに決める。
// markdownlint と同じく、名前の大文字小文字は区別しない。
function fixTarget(name) {
  const lower = name.toLowerCase();
  if (Object.hasOwn(fixCategories, lower) || lower === htmlCategory || lower === tightListsCategory) return `category:${lower}`;
  const id = name.toUpperCase();
  if (Object.hasOwn(ruleAliases, id)) return `rule:${id}`;
  if (ruleIdsByAlias.has(lower)) return `rule:${ruleIdsByAlias.get(lower)}`;
  // 分類名やルール名の綴り違いを、カスタムルールの名前として黙って受け取らない。
  // 分類名の形 (英字と _ だけ) と MD の番号の形は、カスタムルールの名前にしない。
  const known = [...Object.keys(fixCategories), htmlCategory, tightListsCategory, ...ruleIdsByAlias.keys()];
  if (/^MD\d+$/iu.test(name) || /^[a-z_]+$/iu.test(name) || known.some((candidate) => editDistance(lower, candidate) <= 2)) {
    throw new Error(`整形する対象 ${name} は、分類名にもルール名にもありません。`);
  }
  return `custom:${lower}`;
}

function fixSelector(fixes) {
  if (fixes !== undefined && fixes !== null && (typeof fixes !== "object" || Array.isArray(fixes))) {
    throw new TypeError("整形する対象は、名前を真偽値に対応させた表にしてください。");
  }
  const chosen = new Map();
  for (const [name, enabled] of Object.entries(fixes || {})) {
    if (typeof enabled !== "boolean") throw new TypeError(`整形する対象 ${name} は true か false にしてください。`);
    const target = fixTarget(name);
    if (chosen.has(target) && chosen.get(target) !== enabled) {
      throw new Error(`整形する対象 ${name} を、有効と無効の両方に指定しています。`);
    }
    chosen.set(target, enabled);
  }
  // ルール名の指定 > 分類の指定 > 既定。HTML のブロックの整形と、loose のリストを詰めることは markdownlint の修正ではないので、
  // select.html と select.tightLists で別に返す。
  const select = (fix) => {
    const id = ruleId(fix);
    if (Object.hasOwn(ruleAliases, id)) {
      if (chosen.has(`rule:${id}`)) return chosen.get(`rule:${id}`);
      const category = ruleCategories.get(id);
      if (!category) return false;
      return chosen.get(`category:${category}`) ?? !defaultDisabledCategories.includes(category);
    }
    // 表に無い組み込みルールの修正は、確かめるまで当てない。
    if (/^MD\d+$/u.test(id)) return false;
    // カスタムルールは、どの名前 (別名) で指定してもよい。別名どうしで食い違えば整形しない。
    const values = new Set(fix.ruleNames.map((name) => chosen.get(`custom:${name.toLowerCase()}`)).filter((value) => value !== undefined));
    if (values.size > 1) throw new Error(`整形する対象 ${fix.ruleNames.join("・")} を、有効と無効の両方に指定しています。`);
    return values.size ? [...values][0] : true;
  };
  select.html = chosen.get(`category:${htmlCategory}`) ?? true;
  select.tightLists = chosen.get(`category:${tightListsCategory}`) ?? true;
  return select;
}

// 見出しにする修正 (MD018・MD020) を当ててよい行か。
function convertibleHeading(fix, projected, selection) {
  if (!headingConversionRules.has(ruleId(fix))) return true;
  const [row] = fixPosition(fix);
  const line = projected.lines[row - 1];
  // GitLab の課題の参照 (#123) と、既にある見出し (# C# など) は見出しにしない。
  if (!line || /^#+\d/u.test(line.content) || projected.headingRows.has(row)) return false;
  // 範囲整形では、見出しになる文字 (行末の空白を除く) が全部選択に入っているときだけ見出しにする。
  return !selection || line.start + line.content.trimEnd().length <= selection.end;
}

function semanticSnapshot(source, parse) {
  const lines = linesOf(source);
  const { matter, text } = parsedText(source, lines);
  const nodes = parse(text);
  if (!Array.isArray(nodes) || !nodes.length) throw new Error("Markdown を解析できません。");
  const descriptions = [];
  const literals = [];
  // リストと説明の項目の tight (詰まっているか) を、文書の順に並べる。どの修正も、この並びを変えたら当てない
  // (loose になると、項目の段落が <p> で包まれて描画が変わる)。構文木を比べない修正 (見出しなどを作る修正と
  // カスタムルール) も、ここで止める。
  const lists = [];
  for (let index = 0; index < nodes.length; index++) {
    const type = nodeType(nodes[index]);
    if (type === "List" || type === "DescriptionItem") lists.push(nodes[index].data.value[type].tight);
    if (type === "DescriptionList") {
      // 入れ子を含む全項目を比較し、親の引用やリストからの移動も検出する。
      descriptions.push([containerPath(nodes, index), canonicalNode(nodes, index)]);
    }
    if (literalNodes.has(type)) {
      literals.push([containerPath(nodes, index), canonicalNode(nodes, index),
        type === "Math" ? sourceSlice(source, lines, nodes[index].data.sourcepos) : null]);
    }
  }
  const atoms = [...source.matchAll(gitlabAtoms)].map((match) => match[0]);
  // loose (緩い検査) は最初の文書と比べ続ける。tree (構文木の全体) は、受け付けた文書ごとに取り直す。
  return {
    loose: JSON.stringify({ frontMatter: matter?.raw || null, descriptions, literals, atoms, lists }),
    atoms: JSON.stringify(atoms),
    tree: canonicalNode(nodes, 0),
  };
}

// 保護範囲 (コード・数式・HTML) のノードの位置と、緩い検査に入る中身。近道 G の判定に使う。
function literalView(source, parse) {
  const lines = linesOf(source);
  const nodes = parse(parsedText(source, lines).text);
  // ノードの型と行の範囲の木。修正の前後で同じなら、ブロックの構造 (どの行がどのブロックに入るか) も同じ。
  const shape = (index) => {
    const position = nodes[index].data.sourcepos;
    return [nodeType(nodes[index]), position?.start?.line ?? 0, position?.end?.line ?? 0, childIndices(nodes, index).map(shape)];
  };
  // リテラルを含む葉のブロック (段落・見出し・表・コードブロック・HTML のブロック) の行の範囲。
  // 表のセルは同じ行を分け合うので、表の全体を 1 つとみなす。葉のブロックより先に入れ物に着けば null。
  const unitOf = (index) => {
    for (let node = index; node !== undefined; node = nodes[node].parent) {
      const type = nodeType(nodes[node]);
      if (type === "Paragraph" || type === "Heading" || type === "Table" || type === "CodeBlock" || type === "HtmlBlock") {
        const position = nodes[node].data.sourcepos;
        return [position.start.line, position.end.line];
      }
      if (type !== "TableCell" && type !== "TableRow" && (containers.has(type) || type === "Document")) return null;
    }
    return null;
  };
  const literals = [];
  for (let index = 0; index < nodes.length; index++) {
    const type = nodeType(nodes[index]);
    const position = nodes[index].data.sourcepos;
    if (!literalSpanTypes.has(type) || !position?.end?.line) continue;
    literals.push({
      start: sourceOffset(source, lines, position.start, false),
      end: sourceOffset(source, lines, position.end, true),
      value: JSON.stringify(canonicalNode(nodes, index)) + (type === "Math" ? sourceSlice(source, lines, position) : ""),
      unit: unitOf(index),
      // 文書の直下のフェンスのコードブロック (入れ物の接頭辞が無い) の行の範囲と、中身の行の範囲 (フェンスの行を除く)。
      // 中身は、この行だけを解析しても同じになる。
      block: type === "CodeBlock" && nodes[index].data.value.CodeBlock.fenced &&
        nodeType(nodes[nodes[index].parent]) === "Document"
        ? {
          lines: [position.start.line, position.end.line],
          content: [position.start.line + 1, nodes[index].data.value.CodeBlock.closed ? position.end.line - 1 : position.end.line],
        }
        : null,
    });
  }
  return { lines, shape: JSON.stringify(shape(0)), literals };
}

// 文書の直下のコードブロックの行だけを解析した、最初のコードブロックの中身 (無ければ null)。
function blockLiteral(text, parseBlock) {
  const nodes = parseBlock(text);
  const index = nodes.findIndex((node) => nodeType(node) === "CodeBlock");
  return index === -1 ? null : JSON.stringify(canonicalNode(nodes, index));
}

// 保護範囲に掛かる修正のまとめのうち、緩い検査で必ず落ちると分かるもの (全文を解析して確かめなくてよいもの)。
// 1. GitLab の記法の原文と並びが最初の文書と変わるまとめ (正規表現の照合だけで分かる)
// 2. コード・数式・HTML の中身を変えるまとめ。修正がすべて 1 つのリテラルの範囲の中にあって、行を増やしも減らしもしない
//    まとめのうち、リテラルを含む葉のブロック (段落・見出し・表・コードブロック・HTML のブロック) の行がほかのどのまとめとも
//    重ならないものを、いっしょに当てて 1 回だけ解析する。ノードの型と行の範囲の木が今の文書と同じで、そのリテラルの中身が
//    変わっていれば、そのまとめを外す。ブロックの構造が同じなら、リテラルの中身はその葉のブロックの行だけで決まり、
//    ほかのまとめはほかの葉のブロックの中しか変えないので、単独で当てても同じ中身になる (緩い検査は中身を比べるので、
//    単独でも落ちる)。同じ段落の 2 つのコードスパンなどは、片方の修正がもう片方の範囲を変えうる (バッククォートの
//    対応が変わる) ので、いっしょに当てない
// 3. 文書の直下のフェンスのコードブロックの、中身の行だけを書き換えるまとめ (行を増やしも減らしもしない。同じブロックに
//    複数のまとめが掛かるときも)。そのブロックの行だけに当てて小さく解析し、中身が変われば外す。ブロックの行だけを解析した
//    中身が全文の中の中身と同じことを先に確かめる。フェンスの行はそのままなので、中身の行が変われば全文の中でもブロックの
//    中身が変わる (中身の行が閉じのフェンスになっても、全文の中のブロックの中身は短くなる)
// どれにも当たらないまとめは、今までどおり 1 つずつ全文の解析で確かめる。
// 判定は今の文書 (current) に対するもの。使う前に今の文書が変われば、判定し直す (近くの文字が変わると結果が変わりうる)。
function doomedProtectedGroups(groups, current, originalAtoms, parse, parseBlock) {
  const doomed = new Set();
  const rest = [];
  for (const group of groups) {
    const candidate = applyFixes(current, [...group].sort(descendingFix));
    if (candidate === current) continue;
    const atoms = JSON.stringify([...candidate.matchAll(gitlabAtoms)].map((match) => match[0]));
    if (atoms !== originalAtoms) doomed.add(group);
    else rest.push(group);
  }
  if (!rest.length) return doomed;
  const before = literalView(current, parse);
  const touched = new Map();
  for (const group of rest) {
    const indices = new Set();
    for (const fix of group) {
      const [start, end] = fixSpan(fix, before.lines[fixPosition(fix)[0] - 1]);
      before.literals.forEach((literal, index) => {
        if (end > start ? start < literal.end && end > literal.start : literal.start < start && start < literal.end) indices.add(index);
      });
    }
    touched.set(group, indices);
  }
  // 3. 文書の直下のコードブロックの行だけで確かめる。
  const blockValues = new Map();
  for (const group of rest) {
    const indices = touched.get(group);
    if (indices.size !== 1) continue;
    const [index] = indices;
    const block = before.literals[index].block;
    if (!block || !group.every((fix) => fixPosition(fix)[0] >= block.content[0] && fixPosition(fix)[0] <= block.content[1] &&
        fix.fixInfo.deleteCount !== -1 && !/[\r\n]/u.test(fix.fixInfo.insertText || ""))) continue;
    const [first, last] = block.lines;
    const blockText = before.lines.slice(first - 1, last).map((line) => line.content + line.ending).join("");
    if (!blockValues.has(index)) blockValues.set(index, blockLiteral(blockText, parseBlock));
    if (blockValues.get(index) !== before.literals[index].value) continue;
    const shifted = group.map((fix) => ({
      ...fix,
      lineNumber: fixPosition(fix)[0] - first + 1,
      fixInfo: { ...fix.fixInfo, lineNumber: fixPosition(fix)[0] - first + 1 },
    })).sort(descendingFix);
    let edited;
    try {
      edited = applyFixes(blockText, shifted);
    } catch {
      continue;
    }
    if (blockLiteral(edited, parseBlock) !== blockValues.get(index)) doomed.add(group);
  }
  // 2. 残りのうち、修正がすべて 1 つのリテラルの範囲の中にあるまとめを選ぶ (リテラルの外を変える修正は、
  //    リストの印の後の空白などで入れ物の字下げを変え、ほかのブロックの中身を変えうるので混ぜない)。
  const units = new Map();
  for (const group of rest) {
    if (doomed.has(group) || touched.get(group).size !== 1) continue;
    const [index] = touched.get(group);
    const literal = before.literals[index];
    if (!literal.unit || !group.every((fix) => {
      const [start, end] = fixSpan(fix, before.lines[fixPosition(fix)[0] - 1]);
      return (end > start ? literal.start <= start && end <= literal.end : literal.start < start && start < literal.end) &&
        fix.fixInfo.deleteCount !== -1 && !/[\r\n]/u.test(fix.fixInfo.insertText || "");
    })) continue;
    units.set(group, literal.unit);
  }
  // 葉のブロックの行が重なるまとめ (同じ段落の 2 つのリテラルに掛かるものなど) は、どちらもいっしょに当てない。
  const ordered = [...units].sort((a, b) => a[1][0] - b[1][0]);
  const overlapping = new Set();
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length && ordered[j][1][0] <= ordered[i][1][1]; j++) {
      overlapping.add(ordered[i][0]);
      overlapping.add(ordered[j][0]);
    }
  }
  const remaining = rest.filter((group) => units.has(group) && !overlapping.has(group));
  if (remaining.length < 2) return doomed;
  const after = literalView(applyFixes(current, remaining.flat().sort(descendingFix)), parse);
  if (before.shape !== after.shape || before.literals.length !== after.literals.length) return doomed;
  const remainingOwners = new Map();
  for (const group of remaining) for (const index of touched.get(group)) remainingOwners.set(index, (remainingOwners.get(index) || 0) + 1);
  for (const group of remaining) {
    const [index] = touched.get(group);
    if (remainingOwners.get(index) === 1 && before.literals[index].value !== after.literals[index].value) doomed.add(group);
  }
  return doomed;
}

function preferredEnding(source) {
  const counts = new Map();
  for (const [ending] of source.matchAll(/\r\n|\r|\n/gu)) counts.set(ending, (counts.get(ending) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "\n";
}

function fixPosition(error) {
  return [error.fixInfo.lineNumber || error.lineNumber, error.fixInfo.editColumn || 1];
}

function applyFix(source, error) {
  const fix = error.fixInfo;
  const [lineNumber, column] = fixPosition(error);
  const lines = linesOf(source);
  const line = lines[lineNumber - 1];
  if (!line) throw new Error("整形ツールが不正な修正位置を返しました。");
  const start = line.start + column - 1;
  const count = fix.deleteCount || 0;
  if (column < 1 || column > line.content.length + 1 || count < -1 ||
      (count !== -1 && column - 1 + count > line.content.length)) {
    throw new Error("整形ツールが不正な修正範囲を返しました。");
  }
  if (count === -1) {
    // 改行の無い最後の行は、前の行の改行ごと消す (markdownlint が行を結合し直すのと同じ)。
    // そうしないと、末尾の余分な空行を消す MD012 の修正が何も変えない。
    if (!line.ending && lineNumber > 1) {
      const previous = lines[lineNumber - 2];
      return source.slice(0, previous.start + previous.content.length) + source.slice(line.start + line.content.length);
    }
    return source.slice(0, line.start) + source.slice(line.start + line.content.length + line.ending.length);
  }
  const insertion = (fix.insertText || "").replace(/\n/gu, preferredEnding(source));
  return source.slice(0, start) + insertion + source.slice(start + count);
}

// 位置の降順に並んだ修正を順に当てる。結果と例外は applyFix を順に当てたときと同じ。
// 改行が 1 種類 (LF だけか CRLF だけ) の文書では、行の分け直しと改行の数え直しを 1 回にする。CR を含む文書や改行の混ざった
// 文書は、preferredEnding の同数のときの選び方を変えないよう、applyFix を順に当てる。
function applyFixes(source, errors) {
  if (errors.length < 2 || /\r(?!\n)/u.test(source) || (source.includes("\r\n") && /(?<!\r)\n/u.test(source)) ||
      errors.some((error) => /\r/u.test(error.fixInfo.insertText || ""))) {
    return errors.reduce((text, error) => applyFix(text, error), source);
  }
  let ending = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = linesOf(source).map(({ content, ending: own }) => ({ content, ending: own }));
  // 改行の数が 0 になると、preferredEnding は LF を返す。その後に足す改行は LF になり、文書は LF だけになる。
  let endings = lines.filter((line) => line.ending).length;
  for (const error of errors) {
    const fix = error.fixInfo;
    const [lineNumber, column] = fixPosition(error);
    const line = lines[lineNumber - 1];
    if (!line) throw new Error("整形ツールが不正な修正位置を返しました。");
    const count = fix.deleteCount || 0;
    if (column < 1 || column > line.content.length + 1 || count < -1 ||
        (count !== -1 && column - 1 + count > line.content.length)) {
      throw new Error("整形ツールが不正な修正範囲を返しました。");
    }
    if (count === -1) {
      if (!line.ending && lineNumber > 1) {
        lines[lineNumber - 2].ending = "";
      } else if (!line.ending) {
        lines.push({ content: "", ending: "" });
      }
      if (line.ending || lineNumber > 1) endings--;
      lines.splice(lineNumber - 1, 1);
      continue;
    }
    if (!endings) ending = "\n";
    const insertion = (fix.insertText || "").replace(/\n/gu, ending);
    const parts = linesOf(line.content.slice(0, column - 1) + insertion + line.content.slice(column - 1 + count) + line.ending);
    // linesOf は改行で終わる文字列の後ろに空の行を足すので、元の行の分だけに戻す。
    if (parts.length > 1 && !parts.at(-1).content && !parts.at(-1).ending) parts.pop();
    endings += parts.filter((part) => part.ending).length - (line.ending ? 1 : 0);
    lines.splice(lineNumber - 1, 1, ...parts.map(({ content, ending: own }) => ({ content, ending: own })));
  }
  return lines.map((line) => line.content + line.ending).join("");
}

// 試験用。applyFixes が applyFix を順に当てたときと同じ結果を返すことを確かめる。
export const internals = Object.freeze({ applyFix, applyFixes });

async function lint(source, { main }, { filename, cwd, config, stats }) {
  if (stats) stats.lints++;
  let results = [];
  const errors = [];
  const argv = [`:${filename}`];
  if (typeof config === "string") argv.push("--config", path.resolve(cwd, config));
  // プロジェクト設定とインライン設定の読み込みは CLI2 に任せる。
  // fix と出力フォーマッターだけを上書きし、ファイルへの書き込みを禁止する。
  const readOnlyFs = {
    ...fs,
    promises: {
      ...fs.promises,
      writeFile: async () => { throw new Error("整形処理からファイルには書き込めません。"); },
    },
  };
  let status;
  try {
    status = await main({
      directory: cwd,
      argv,
      noGlobs: true,
      fileContents: { [filename]: source },
      fs: readOnlyFs,
      optionsDefault: typeof config === "object" && config !== null ? { config } : undefined,
      optionsOverride: {
        fix: false,
        noBanner: true,
        noProgress: true,
        outputFormatters: [[({ results: captured }) => { results = captured; }]],
      },
      logMessage() {},
      logError(message) { errors.push(message); },
    });
  } catch (error) {
    throw new Error(`Markdownlint の設定またはルールを読み込めません: ${String(error.message).split(/[\r\n]/u)[0]}`, { cause: error });
  }
  if (errors.length) throw new Error("Markdownlint の設定またはルールを読み込めません。");
  if (status !== 0 && status !== 1) throw new Error("Markdownlint の設定を読み込めません。");
  if (results.some((result) => result.errorDetail?.startsWith("This rule threw an exception:"))) {
    throw new Error("Markdownlint のルール実行に失敗しました。");
  }
  // Windows のドライブ文字の大小が違っても同じファイルと見なす。
  return results.filter((result) => result.fixInfo && path.relative(path.resolve(cwd, result.fileName), filename) === "");
}

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== "" && !path.isAbsolute(relative) && relative.split(/[\\/]/u)[0] !== "..";
}

function selectedRange(source, range) {
  if (!range) return null;
  const lines = linesOf(source);
  const boundary = (position, inclusive) => {
    const line = lines[position[0] - 1];
    if (!line) return source.length;
    const bytes = Buffer.from(line.content);
    let column = position[1] ?? (inclusive ? Infinity : 0);
    if (!Number.isFinite(column)) return line.start + line.content.length;
    column = Math.min(bytes.length, Math.max(0, column + (inclusive ? 1 : 0)));
    if (inclusive) {
      // Neovim の終点が文字の先頭バイトでも、選択した文字全体を含める。
      while (column < bytes.length && (bytes[column] & 0xc0) === 0x80) column++;
    } else {
      while (column > 0 && (bytes[column] & 0xc0) === 0x80) column--;
    }
    return line.start + bytes.subarray(0, column).toString("utf8").length;
  };
  return { start: boundary(range.start, false), end: boundary(range.end, true) };
}

// lines は今の文書の行 (候補ごとに文書全体を分け直さない)。
function inRange(lines, fix, selection) {
  if (!selection) return true;
  const [row, column] = fixPosition(fix);
  const line = lines[row - 1];
  if (!line) return false;
  // fixInfo は UTF-16 なので、変換済みの選択範囲と直接比較できる。
  let fixStart = line.start + column - 1;
  let fixEnd = fixStart + Math.max(0, fix.fixInfo.deleteCount || 0);
  if (fix.fixInfo.deleteCount === -1 || /\r|\n/u.test(fix.fixInfo.insertText || "")) {
    fixStart = line.start;
    fixEnd = line.start + line.content.length + line.ending.length;
  }
  return fixStart >= selection.start && fixEnd <= selection.end &&
    (fix.fixInfo.deleteCount || fixStart < selection.end);
}

function fixGroups(fixes, itemLists) {
  const groups = [];
  const markerGroups = new Map();
  const unique = new Set();
  for (const fix of fixes) {
    const key = JSON.stringify([fixPosition(fix), fix.fixInfo]);
    if (unique.has(key)) continue;
    unique.add(key);
    const [line, column] = fixPosition(fix);
    const list = itemLists.get(`${line}:${column}`);
    // 記号 (MD004) と番号 (MD029) は、リストごとにまとめて当てるか見送る。1 項目めの番号だけ見送ると、
    // 開始番号は保てても `3. 2. 3.` のような番号が残る。
    const marker = (ruleId(fix) === "MD004" && /^[*+-]$/u.test(fix.fixInfo.insertText || "")) ||
      // 右揃えの番号 (` 3.` と `10.`) では、修正の文字に空白が入る。
      (ruleId(fix) === "MD029" && /^ *\d+$/u.test(fix.fixInfo.insertText || ""));
    if (marker && list !== undefined && fix.fixInfo.deleteCount >= 1) {
      const key = `${ruleId(fix)}:${list}`;
      if (!markerGroups.has(key)) {
        const group = [];
        markerGroups.set(key, group);
        groups.push(group);
      }
      markerGroups.get(key).push(fix);
    } else {
      groups.push([fix]);
    }
  }
  groups.forEach((group) => group.sort(descendingFix));
  return groups.sort((a, b) => descendingFix(a[0], b[0]));
}

// 下の行・右の列の修正を先にする (先に当てても、残りの修正の位置がずれない)。
function descendingFix(a, b) {
  const [aLine, aColumn] = fixPosition(a);
  const [bLine, bColumn] = fixPosition(b);
  return bLine - aLine || bColumn - aColumn || Number(a.fixInfo.deleteCount === -1) - Number(b.fixInfo.deleteCount === -1);
}

// 行頭 (入れ物の > ・リストの印・説明の : ・脚注の定義の後を含む) にタグのある行。HTML のブロックの無い文書を、解析せずに
// 見分ける (広めに当たっても解析が 1 回増えるだけ)。<https://…> の autolink には当たらない。
const htmlBlockHint = new RegExp(String.raw`^[ \t>]*(?:(?:[-*+:~]|\d{1,9}[.)]|\[\^[^\]\r\n]+\]:)[ \t]+[ \t>]*)*` +
  String.raw`<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>]|$)`, "mu");
// HTML のタグ・コメント・宣言。それ以外は文字。
const htmlTokens = new RegExp([
  String.raw`<!--[\s\S]*?-->`, String.raw`<![^>]*>`, String.raw`<\?[\s\S]*?\?>`,
  String.raw`<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>\x60]+))?)*\s*\/?>`,
].join("|"), "gu");

// タグの引用符の外の空白の並びを 1 つにし、= の前後と閉じ (> と />) の前の空白を消す。
function normalizedTag(token) {
  return token.replace(/("[^"]*"|'[^']*')|(\s*=\s*)|(\s+(?=\/?>$))|\s+/gu,
    (match, quoted, equals, closing) => quoted ?? (equals !== undefined ? "=" : closing !== undefined ? "" : " "));
}

// 描画が同じ HTML を同じ値にする。疑わしい差は残す (整形を拒む側に倒す)。
// 1. 空白がそのまま出る要素 (whitespaceElements と、style に white-space を書いた要素) の中の文字は原文のまま
// 2. それ以外の文字は、ASCII の空白の並びを空白 1 つに畳む。ブロック要素のタグ・<br>・文書の端に接する空白は消す
// 3. インライン要素どうしの間の空白は有無を残す (<b>a</b><i>b</i> と <b>a</b> <i>b</i> は別の値)。コメントは原文のまま
function normalizedHtml(html) {
  const items = [];
  // 空白がそのまま出る要素の、開いているものの名前と、同じ名前の入れ子の深さ。
  const exact = [];
  let last = 0;
  const pushText = (text) => {
    if (text) items.push(exact.length ? ["raw", text] : ["text", text.replace(/[ \t\n\f\r]+/gu, " ")]);
  };
  for (const match of html.matchAll(htmlTokens)) {
    pushText(html.slice(last, match.index));
    last = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith("<!") || token.startsWith("<?")) {
      items.push(["markup", token]);
      continue;
    }
    const [, slash, name] = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/u.exec(token);
    const lower = name.toLowerCase();
    items.push(["tag", normalizedTag(token), blockElements.has(lower)]);
    const open = exact.at(-1);
    if (slash) {
      if (open?.name === lower && --open.depth === 0) exact.pop();
    } else if (!token.endsWith("/>")) {
      if (open?.name === lower) open.depth++;
      else if (whitespaceElements.includes(lower) || /\sstyle\s*=\s*(?:"[^"]*white-space|'[^']*white-space|[^\s>]*white-space)/iu.test(token)) {
        exact.push({ name: lower, depth: 1 });
      }
    }
  }
  pushText(html.slice(last));
  const result = [];
  items.forEach((item, index) => {
    if (item[0] !== "text") {
      result.push(item[0] === "tag" ? ["tag", item[1]] : item);
      return;
    }
    const boundary = (neighbor) => !neighbor || (neighbor[0] === "tag" && neighbor[2]);
    let text = item[1];
    if (boundary(items[index - 1])) text = text.replace(/^ /u, "");
    if (boundary(items[index + 1])) text = text.replace(/ $/u, "");
    if (text) result.push(["text", text]);
  });
  return JSON.stringify(result);
}

// 整形の対象にできる HTML のブロックと、整形した行。js-beautify が直すものが無ければ空。
// 対象は一般のタグで始まるブロック (種類 6・7) だけ。pre・script・style・textarea で始まるもの (種類 1) とコメント (種類 2) などは変えない。
// ブロックの各行が「入れ物の接頭辞 + literal の行」になっているものだけを扱う (タブや、揃わない接頭辞の続きの行があれば見送る)。
function htmlBlockEdits(source, lines, nodes, selection, beautify) {
  const ending = preferredEnding(source);
  const edits = [];
  for (const node of nodes) {
    if (nodeType(node) !== "HtmlBlock") continue;
    const { block_type: blockType, literal } = node.data.value.HtmlBlock;
    const position = node.data.sourcepos;
    if ((blockType !== 6 && blockType !== 7) || !position?.start.line || !position?.end.line) continue;
    const rows = literal.replace(/(?:\r\n|\r|\n)$/u, "").split(/\r\n|\r|\n/u);
    const first = position.start.line;
    if (rows.length !== position.end.line - first + 1) continue;
    const prefixes = [];
    for (const [offset, row] of rows.entries()) {
      const line = lines[first - 1 + offset];
      if (!line || !line.content.endsWith(row)) break;
      prefixes.push(line.content.slice(0, line.content.length - row.length));
    }
    if (prefixes.length !== rows.length || prefixes.some((prefix) => prefix.includes("\t")) ||
        prefixes.slice(2).some((prefix) => prefix !== prefixes[1])) continue;
    const start = lines[first - 1].start;
    const lastLine = lines[first - 2 + rows.length];
    const end = lastLine.start + lastLine.content.length;
    // 範囲整形では、ブロックの全体 (行頭の入れ物の接頭辞を除く) が選択に入るときだけ。
    if (selection && (start + prefixes[0].length < selection.start || end > selection.end)) continue;
    // 中身を変えない要素の表は、整形器が書き換えても次のブロックに残らないよう毎回作る。
    const formatted = beautify(rows.join("\n"), { ...beautifyOptions, content_unformatted: [...whitespaceElements] });
    if (typeof formatted !== "string") throw new Error("HTML の整形器が文字列を返しませんでした。");
    const output = formatted.split(/\r\n|\r|\n/u);
    // 空の行はブロックを終わらせ、後ろの行を Markdown にするので当てない。
    if (formatted === rows.join("\n") || output.some((row) => !row.trim())) continue;
    // 2 行目からの接頭辞は元の 2 行目のもの。1 行だったブロックは、1 行目の接頭辞の > 以外 (リストの印など) を空白にする
    // (脚注の定義のように、続きの行の字下げが 1 行目の接頭辞と違う入れ物では外れる。当てた後の literal の確かめで外す)。
    const continuation = rows.length > 1 ? prefixes[1] : prefixes[0].replace(/[^>]/gu, " ");
    const replacement = output.map((row, index) => (index ? continuation : prefixes[0]) + row).join(ending);
    edits.push({ start, end, replacement, line: first, rows: rows.length, output });
  }
  return edits;
}

// 当てた後の文書で、整形したブロックの literal が整形の結果と同じか (入れ物が 2 行目から思ったとおりの接頭辞を取るか)。
// 違えば、次の整形でまた字下げが変わる。
function htmlEditsLanded(nodes, edits) {
  const literals = new Map();
  for (const node of nodes) {
    if (nodeType(node) === "HtmlBlock" && node.data.sourcepos?.start.line) {
      literals.set(node.data.sourcepos.start.line, node.data.value.HtmlBlock.literal);
    }
  }
  let shift = 0;
  return [...edits].sort((a, b) => a.start - b.start).every((edit) => {
    const literal = literals.get(edit.line + shift);
    shift += edit.output.length - edit.rows;
    return literal !== undefined &&
      literal.replace(/(?:\r\n|\r|\n)$/u, "").split(/\r\n|\r|\n/u).join("\n") === edit.output.join("\n");
  });
}

function applyHtmlEdits(source, edits) {
  return [...edits].sort((a, b) => b.start - a.start)
    .reduce((text, { start, end, replacement }) => text.slice(0, start) + replacement + text.slice(end), source);
}

// HTML のブロックを整形して、描画と構造の変わらないものだけを当てる。
// 1. 描画: Comrak の HTML (生の HTML を出す) を normalizedHtml で比べる
// 2. 構造: 構文木の全体を、HtmlBlock の中身だけ normalizedHtml にして比べる (ブロックの分割・結合や、Markdown の行の取り込み、
//    リストの tight の変化を見つける)
// 3. GitLab の記法: 原文と並びを比べる
// 4. 整形したブロックの literal が整形の結果と同じ (2 回目の整形で変わらない)
// まとめて当てて 1 回で確かめ、変わるときだけ半分に分けて原因のブロックを外す。ブロックどうしは重ならない。
// Markdown をはさんだ断片 (<details> と </details> の間に本文があるものなど) は、断片ごとに入れ物の字下げから整形する。
// 前の断片の深さを持ち越して 1 行目を 4 つ以上字下げすると、空行の後ではコードブロックになるため。
function formatHtmlBlocks(source, { parse, render, beautify, selection, exhaustive }) {
  if (!exhaustive && !htmlBlockHint.test(source)) return source;
  const lines = linesOf(source);
  const edits = htmlBlockEdits(source, lines, parse(parsedText(source, lines).text), selection, (text, settings) => beautify()(text, settings));
  if (!edits.length) return source;
  const htmlTree = (node) => (node[0] === "HtmlBlock"
    ? [node[0], { block_type: node[1].block_type, html: normalizedHtml(node[1].literal) }, node[2]]
    : node);
  const snapshot = (text, applied) => {
    const textLines = linesOf(text);
    const { matter, text: parsed } = parsedText(text, textLines);
    const nodes = parse(parsed);
    if (applied && !htmlEditsLanded(nodes, applied)) return null;
    return JSON.stringify([
      matter?.raw || null,
      [...text.matchAll(gitlabAtoms)].map((match) => match[0]),
      normalizedHtml(render(parsed)),
      mapTree(canonicalNode(nodes, 0), htmlTree),
    ]);
  };
  const expected = snapshot(source);
  const accepted = [];
  const accept = (batch) => {
    if (!batch.length) return;
    const applied = [...accepted, ...batch];
    if (snapshot(applyHtmlEdits(source, applied), applied) === expected) {
      accepted.push(...batch);
      return;
    }
    if (batch.length === 1) return;
    const middle = Math.ceil(batch.length / 2);
    accept(batch.slice(0, middle));
    accept(batch.slice(middle));
  };
  accept(edits);
  const result = applyHtmlEdits(source, accepted);
  if (selection) selection.end += result.length - source.length;
  return result;
}

// 試験用。描画の比較に使う正規化。
export const htmlInternals = Object.freeze({ normalizedHtml });

// 空行の後に、リストの印か字下げした行が続く所 (入れ物の > の後を含む)。loose のリストの無い文書を、解析せずに見分ける
// (広めに当たっても解析が 1 回増えるだけ)。
const looseListHint = new RegExp(String.raw`^[ \t]*(?:>[ \t]?)*[ \t]*(?:\r\n?|\n)(?:[ \t]*>[ \t]?)*` +
  String.raw`(?:[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|\r?$)|(?: {2,}|\t)[ \t]*\S)`, "mu");

// loose のリストごとに、詰めるために消す行 (1 から数える)。消すのは、となり合う項目の間と、1 つの項目の中のとなり合う
// ブロックの間の空行 (引用の中では > だけの行) だけ。コード・HTML・数式・入れ子のリストなどの中の行と、最後の項目の後の行は
// 消さない (項目の子のブロックの間しか見ないので、子の中の行には触れない)。詰めると段落がつながるリスト (1 つの項目に
// 段落が続けて 2 つある・段落の後に字下げのコードがある) は見送る。ほかの詰められないもの (段落を割り込めないブロックが
// 続くものなど) は、当てた後の確かめで落とす。範囲を指定したときは、範囲に収まるリストだけを扱う。
function listTighteningEdits(lines, nodes, selection) {
  const edits = [];
  const blank = (row) => /^[ \t>]*$/u.test(lines[row - 1]?.content ?? "x");
  for (let index = 0; index < nodes.length; index++) {
    if (nodeType(nodes[index]) !== "List" || nodes[index].data.value.List.tight) continue;
    const { start, end } = nodes[index].data.sourcepos;
    if (selection && (lines[start.line - 1].start < selection.start ||
        lines[end.line - 1].start + lines[end.line - 1].content.length > selection.end)) continue;
    const rows = [];
    let mergeable = true;
    // 子のブロックの終わりの行。引用の中では、Comrak は入れ子のリストの終わりを、後ろの空行 (> だけの行) まで含めるので、
    // その空行は除く (除いた空行も、ブロックの間の空行として消す)。
    const lastRow = (node) => {
      let row = node.data.sourcepos.end.line;
      while (row > node.data.sourcepos.start.line && blank(row)) row--;
      return row;
    };
    const items = childIndices(nodes, index);
    items.forEach((item, position) => {
      const children = childIndices(nodes, item);
      for (let child = 1; child < children.length; child++) {
        const [previous, next] = [nodes[children[child - 1]], nodes[children[child]]];
        if (nodeType(previous) === "Paragraph" && (nodeType(next) === "Paragraph" ||
            (nodeType(next) === "CodeBlock" && !next.data.value.CodeBlock.fenced))) mergeable = false;
        for (let row = lastRow(previous) + 1; row < next.data.sourcepos.start.line; row++) rows.push(row);
      }
      if (position + 1 < items.length) {
        const last = children.length ? lastRow(nodes[children.at(-1)]) : nodes[item].data.sourcepos.start.line;
        for (let row = last + 1; row < nodes[items[position + 1]].data.sourcepos.start.line; row++) rows.push(row);
      }
    });
    if (mergeable && rows.length && rows.every(blank)) edits.push({ list: index, rows });
  }
  return edits;
}

function deleteRows(source, lines, rows) {
  let result = source;
  // 同じ行を 2 回消さない (行の位置は元の文書のもの)。下の行から消す。
  for (const row of [...new Set(rows)].sort((a, b) => b - a)) {
    const line = lines[row - 1];
    result = result.slice(0, line.start) + result.slice(line.start + line.content.length + line.ending.length);
  }
  return result;
}

// 2 つの解析の結果が、targets のリストの tight が false から true になったことを除いて、ノードごとに同じか。
// 空行を消すだけなら、ノードの数・親子と兄弟のつながり・中身は変わらない。
function sameTreeExceptTight(before, after, targets) {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index++) {
    const [left, right] = [before[index], after[index]];
    if (left.parent !== right.parent || left.first_child !== right.first_child || left.next_sibling !== right.next_sibling ||
        nodeType(left) !== nodeType(right)) return false;
    const [leftValue, rightValue] = [nodeValue(left), nodeValue(right)];
    if (targets.has(index)) {
      if (leftValue.tight !== false || rightValue.tight !== true) return false;
      if (JSON.stringify({ ...leftValue, tight: true }) !== JSON.stringify(rightValue)) return false;
    } else if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
      return false;
    }
  }
  return true;
}

// loose のリストを詰めて tight にする (分類 tight_lists)。当てた後の構文木が、対象のリストの tight のほかはノードごとに
// 同じものだけを当てる (描画は、対象の項目の段落を包む <p> が無くなることだけが変わる)。まとめて当てて 1 回で確かめ、
// 違うときだけ半分に分けて原因のリストを外す。リストどうしの消す行は重ならない。
function tightenLists(source, { parse, selection, exhaustive }) {
  if (!exhaustive && !looseListHint.test(source)) return source;
  const lines = linesOf(source);
  const before = parse(parsedText(source, lines).text);
  const edits = listTighteningEdits(lines, before, selection);
  if (!edits.length) return source;
  const accepted = [];
  const apply = (chosen) => deleteRows(source, lines, chosen.flatMap((edit) => edit.rows));
  const accept = (batch) => {
    if (!batch.length) return;
    const chosen = [...accepted, ...batch];
    const candidate = apply(chosen);
    if (sameTreeExceptTight(before, parse(parsedText(candidate, linesOf(candidate)).text), new Set(chosen.map((edit) => edit.list)))) {
      accepted.push(...batch);
      return;
    }
    if (batch.length === 1) return;
    const middle = Math.ceil(batch.length / 2);
    accept(batch.slice(0, middle));
    accept(batch.slice(middle));
  };
  accept(edits);
  const result = apply(accepted);
  if (selection) selection.end += result.length - source.length;
  return result;
}

export async function formatMarkdown(source, options = {}) {
  if (typeof source !== "string") throw new TypeError("Markdown の入力は文字列にしてください。");
  if (!options.filename || !path.isAbsolute(options.filename)) {
    throw new Error("整形対象の絶対ファイル名を指定してください。");
  }
  const filename = path.normalize(options.filename);
  const settings = { ...options, filename, cwd: path.resolve(options.cwd || path.dirname(filename)) };
  if (options.range && (!Array.isArray(options.range.start) || !Array.isArray(options.range.end) ||
      !Number.isInteger(options.range.start[0]) || !Number.isInteger(options.range.end[0]) ||
      options.range.start[0] < 1 || options.range.end[0] < options.range.start[0] ||
      (options.range.start[1] !== undefined && (!Number.isInteger(options.range.start[1]) || options.range.start[1] < 0)) ||
      (options.range.end[1] !== undefined && options.range.end[1] !== Infinity &&
       (!Number.isInteger(options.range.end[1]) || options.range.end[1] < -1)))) {
    throw new Error("整形範囲の行または列番号が不正です。");
  }
  const selection = selectedRange(source, options.range);
  if (selection && selection.end < selection.start) throw new Error("整形範囲の開始と終了が逆です。");
  const selected = fixSelector(options.fixes);
  const dependencies = await runtime(options.runtimeDir || scriptDirectory);
  // 試験用: exhaustive は近道 (修正候補が無いときの早い終わりと、保護範囲の修正と、詰まったリストに空行を足す修正を
  // 解析せずに拒むこと、HTML のブロックの無い文書を解析せずに見分けること) を使わない。stats には、文書全体の Comrak の解析 (parses)・コードブロックの行だけの
  // 解析 (blockParses)・lint (lints)・HTML の描画 (renders) を実際に呼んだ回数を足す。
  // beautifyHtml は、HTML のブロックの整形器 (js-beautify の html と同じ引数) を差し替える。
  const { exhaustive, stats } = options;
  if (stats) {
    for (const key of ["parses", "blockParses", "lints", "renders"]) stats[key] ??= 0;
  }
  if (options.beautifyHtml !== undefined && typeof options.beautifyHtml !== "function") {
    throw new TypeError("beautifyHtml は関数にしてください。");
  }
  const parseBlock = (text) => {
    if (stats) stats.blockParses++;
    return dependencies.parseMarkdown(text, parserOptions).nodes;
  };
  // 同じ文字列の解析の結果と検査の値を、この呼び出しの中でだけ使い回す (projection・候補の検査・終わりの確かめ)。
  const parsedNodes = new Map();
  const parse = (text) => {
    if (parsedNodes.has(text)) return parsedNodes.get(text);
    const { nodes } = dependencies.parseMarkdown(text, parserOptions);
    if (stats) stats.parses++;
    parsedNodes.set(text, nodes);
    if (parsedNodes.size > 4) parsedNodes.delete(parsedNodes.keys().next().value);
    return nodes;
  };
  const render = (text) => {
    if (stats) stats.renders++;
    return dependencies.markdownToHTML(text, { ...parserOptions, render: { unsafe: true } });
  };
  const beautify = () => options.beautifyHtml || htmlBeautifier(options.runtimeDir || scriptDirectory);
  // markdownlint の修正が終わった文書に、HTML のブロックの整形を最後に 1 回当てる (lint は HTML の中を変えないので、
  // 整形した HTML を崩さない。lint の修正でできた HTML のブロックも、同じ保存で整形する)。
  const finish = (text) => (selected.html
    ? formatHtmlBlocks(text, { parse, render, beautify, selection, exhaustive })
    : text);
  // loose のリストを最初に詰める。詰めた文書を、この後の修正の基準 (緩い検査の最初の文書) にする。詰める処理は構文木を
  // ノードごとに確かめるので、基準を替えても、守る記法・リテラル・ほかのリストの tight は元の文書と同じ。
  // markdownlint の修正 (MD031・MD032 など) が項目の中に空行を足して loose に戻すものは、緩い検査のリストの並びで落ちる。
  const start = selected.tightLists ? tightenLists(source, { parse, selection, exhaustive }) : source;
  const snapshots = new Map();
  const snapshotOf = (text) => {
    if (!snapshots.has(text)) {
      snapshots.set(text, semanticSnapshot(text, parse));
      if (snapshots.size > 4) snapshots.delete(snapshots.keys().next().value);
    }
    return snapshots.get(text);
  };
  // 最初の文書の検査の値。修正候補を確かめるときに初めて作る。
  let original;
  const originalOf = () => (original ??= snapshotOf(start));
  // 構文木の全体は、最後に受け付けた文書と比べる (見出しなどを作る修正の後も、その先の修正を確かめられる)。
  // 変えてよい差の決まったルール (limitedRules) がまとめに入っていれば、その差だけを両方の木から消して比べる。
  // 表記の修正は見出しの句読点やリンクの文字を変えないので、同じまとめで確かめても見逃さない。
  let currentTree;
  let currentKeys = new Map();
  const relaxations = (batch) => [...new Set(batch.flat().map(ruleId).filter((id) => Object.hasOwn(limitedRules, id)))].sort();
  const structureKey = (tree, rules) => JSON.stringify(rules.reduce((value, id) => mapTree(value, limitedRules[id]), tree));
  const currentKey = (rules) => {
    currentTree ??= originalOf().tree;
    const key = rules.join(",");
    if (!currentKeys.has(key)) currentKeys.set(key, structureKey(currentTree, rules));
    return currentKeys.get(key);
  };
  const visited = new Set([start]);
  let current = start;
  let attempted = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let fixes = await lint(current, dependencies, settings);
    // 選ばれる修正が無く、説明リストの印も無い文書は、解析せずにそのまま返す (印があれば、引用に見立てた lint が修正を足しうる)。
    // 印の判定は広めにし、疑わしいときは今までどおり解析する。
    if (pass === 0 && !exhaustive && !fixes.some((fix) => selected(fix)) && !/^[ \t>]*[:~][ \t]/mu.test(current)) {
      return finish(current);
    }
    const projected = projection(current, parse);
    if (projected.source !== current) {
      // リストの表記は正しい階層を持つ引用版を基準とし、元の解析との往復を防ぐ。
      // 説明の中の行の字下げ (MD005 / MD007) も引用版だけで見る。元の解析は説明リストを知らず、
      // その修正は必ず却下されるので、保存のたびに検証の手間だけが掛かる。
      fixes = fixes.filter((fix) => fix.ruleNames[0] !== "MD004" &&
        !(indentRules.has(fix.ruleNames[0]) && projected.projectedRows.has(fixPosition(fix)[0])));
      fixes.push(...(await lint(projected.source, dependencies, settings))
        .filter((fix) => !projected.syntheticBlankRows.has(fixPosition(fix)[0]))
        .map((fix) => fromProjection(fix, projected))
        .filter(Boolean));
    }
    // 選ばれていない修正と、見出しにしてはいけない行の修正は、まとめを作る前に外す。
    fixes = fixes.filter((fix) => selected(fix) && convertibleHeading(fix, projected, selection));
    // 詰まったリストの項目の間や項目の中のブロックの間に空行を足す修正 (MD031・MD032 など) は、リストを loose にするので
    // 必ず落ちる。全文を解析して確かめずに外す (近道 L)。tight_lists で詰めたリストには、markdownlint が空行を求める所が多く、
    // 確かめると半分に分ける解析が修正の数だけ増える。
    if (!exhaustive) fixes = fixes.filter((fix) => !projected.tightBoundaryRows.has(insertedBlankRow(fix)));
    // 範囲で先に絞ると、通常のリストでも一部のマーカーだけが変わって分裂する。
    const groups = fixGroups(fixes, projected.itemLists)
      .filter((group) => group.every((fix) => inRange(projected.lines, fix, selection)));
    // 検証は文書全体を Comrak で解析し直すので、修正ごとに確かめると長い文書で保存の上限を超える。
    // まとめて当てて 1 回で確かめ、構造が変わるときだけ半分に分けて原因の修正を除く。
    // まとめは下の行から並んでいるので、どの部分を当てても残りの修正位置はずれない。
    // 同じリストのマーカー変更は 1 つのまとめのまま扱い、途中の混在でリストが分裂するのを避ける。
    // 緩い検査 (説明リスト・リテラル・GitLab の記法) は常に最初の文書と、構文木の全体は今の文書と比べる。
    const accept = (batch, mode) => {
      if (!batch.length) return;
      // リストごとのまとめは複数の行にまたがるので、まとめの順ではなく修正の位置の順 (下・右から) に当てる。
      const candidate = applyFixes(current, batch.flat().sort(descendingFix));
      if (candidate === current) return;
      const snapshot = snapshotOf(candidate);
      const rules = relaxations(batch);
      if (snapshot.loose === originalOf().loose &&
          (mode === "creating" || structureKey(snapshot.tree, rules) === currentKey(rules))) {
        // 範囲内の改行増減に追従し、次の解析で元の選択範囲外を整形しない。
        if (selection) selection.end += candidate.length - current.length;
        current = candidate;
        currentTree = snapshot.tree;
        currentKeys = new Map();
        return;
      }
      if (batch.length === 1) return;
      const middle = Math.ceil(batch.length / 2);
      accept(batch.slice(0, middle), mode);
      accept(batch.slice(middle), mode);
    };
    let changed = false;
    let pending = groups;
    while (pending.length && !changed) {
      const batch = [];
      const deferred = [];
      // 選んだ修正の範囲を行ごとに持つ (重なりは同じ行の範囲どうしでしか起きない)。
      const selectedRanges = new Map();
      // 長さの変わる修正を含むリストのまとめが書き換える行。まとめは上の行にも及ぶので、
      // 同じ行のほかの修正と一緒に当てると、半分に分けて確かめたときに後から当てる側の列がずれる。
      const shiftedLines = new Set();
      const selectedLines = new Set();
      for (const group of pending) {
        const ranges = group.map((fix) => {
          const [line, column] = fixPosition(fix);
          return { line, column, end: column + Math.max(0, fix.fixInfo.deleteCount || 0), deleted: fix.fixInfo.deleteCount === -1 };
        });
        const shifting = group.length > 1 && group.some((fix) => fix.fixInfo.deleteCount === -1 ||
          (fix.fixInfo.insertText || "").length !== Math.max(0, fix.fixInfo.deleteCount || 0));
        // 同じ解析結果に基づく重複修正は同時に当てない。ほかが当たれば次の解析で再評価し、
        // 何も当たらなかったときは、位置がずれていないのでこのまま残りを試す。
        if (ranges.some((candidate) => shiftedLines.has(candidate.line) || (shifting && selectedLines.has(candidate.line)) ||
            (selectedRanges.get(candidate.line) || []).some((range) =>
              candidate.deleted || range.deleted || (candidate.end > range.column && candidate.column < range.end) ||
              candidate.column === range.column))) {
          deferred.push(group);
          continue;
        }
        attempted += group.length;
        if (attempted > MAX_FIXES) throw new Error("修正が多すぎるため整形を中止しました。");
        for (const range of ranges) {
          if (!selectedRanges.has(range.line)) selectedRanges.set(range.line, []);
          selectedRanges.get(range.line).push(range);
          selectedLines.add(range.line);
          if (shifting) shiftedLines.add(range.line);
        }
        batch.push(group);
      }
      const before = current;
      // コードや数式の中身と GitLab の記法を変える修正は、ほとんど却下される。まとめに混ぜると半分に分ける検証が
      // 増えるので、前後のまとめと順番を保ったまま 1 つずつ確かめる (結果は同じで、手間だけが減る)。
      // 確かめ方の違う修正も、順番を保ったまま別のまとめにする。
      let run = [];
      let runMode;
      const flush = () => {
        accept(run, runMode);
        run = [];
      };
      const protectedList = batch.filter((group) => group.some((fix) => touchesProtected(fix, projected)));
      const protectedGroups = new Set(protectedList);
      // 緩い検査で必ず落ちると分かる保護範囲のまとめは、全文を解析して確かめない (近道 G)。判定は今の文書に対するものなので、
      // 先の修正が当たって今の文書が変わったら、残りのまとめを判定し直す。
      let doomed = new Set();
      let judged;
      let protectedIndex = 0;
      for (const group of batch) {
        const mode = fixMode(group[0]);
        if (protectedGroups.has(group)) {
          flush();
          if (!exhaustive && judged !== current) {
            doomed = doomedProtectedGroups(protectedList.slice(protectedIndex), current, originalOf().atoms, parse, parseBlock);
            judged = current;
          }
          protectedIndex++;
          if (!doomed.has(group)) accept([group], mode);
        } else {
          if (run.length && mode !== runMode) flush();
          runMode = mode;
          run.push(group);
        }
      }
      flush();
      changed = current !== before;
      pending = deferred;
    }
    if (!changed) {
      if (snapshotOf(current).loose !== originalOf().loose) {
        throw new Error("文書の構造 (説明リストかリストの詰まり) を保持できませんでした。");
      }
      return finish(current);
    }
    if (visited.has(current)) throw new Error("整形結果が収束しないため中止しました。");
    visited.add(current);
  }
  throw new Error("整形結果が収束しないため中止しました。");
}

// 予備では依存だけを先に読み、設定・ルールの読み込みとエラーの表示は要求まで待つ。
// 依存の場所を省くと、このファイルのフォルダ (導入先) から読む。読めたかどうかを返す (失敗は投げない)。
export function preload(runtimeDir = scriptDirectory) {
  const directory = runtimeDir || scriptDirectory;
  try {
    nodeModule.enableCompileCache?.(path.join(path.resolve(directory), ".compile-cache"));
  } catch {
    // compile cache は速さのためだけのもの。
  }
  return runtime(directory).then(() => {
    try {
      htmlBeautifier(directory);
    } catch {
      // HTML の整形器が無ければ、要求で HTML のブロックを整形するときに知らせる。
    }
    return true;
  }).catch(() => false);
}

// mdfmt の入口。CLI の本体は cli.mjs にあり、ここから読み込む (cli.mjs も formatMarkdown を読むので、
// 読み込みを待たずに進め、このファイルの評価を先に終える)。
// Node は実体のパスで読み込むので、シンボリックリンクやジャンクションを通った起動も実体で比べる。
// 一致しないと何も出力せずに終わり、conform は空の出力として黙って整形をやめる。
function isMainScript() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainScript()) {
  import("./cli.mjs").then(({ main }) => main(), (error) => {
    process.stderr.write(`mdfmt: ${error?.message?.split(/[\r\n]/u)[0] || "不明なエラー"}\n`);
    process.exitCode = 2;
  });
}
