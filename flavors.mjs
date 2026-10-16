// 方言 (GLFM と GFM) ごとの違いの表。format.mjs が、解析・描画の比べ・front matter・守る記法・説明リストの投影・
// 見出しにしない行・HTML の比べのブロック要素を、ここから選ぶ。GitHub の値は、GitHub の Markdown API で確かめたもの
// (docs/verification/readme.md)。

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

// 中の空白がそのまま描画に出る要素。
// listing・xmp・plaintext は、ブラウザの既定のスタイルが white-space: pre になる。
const whitespaceElements = Object.freeze(["pre", "textarea", "script", "style", "code", "kbd", "samp", "listing", "xmp", "plaintext"]);
// 前後の空白が描画に出ない要素。
const blockElements = new Set([
  "address", "article", "aside", "blockquote", "body", "br", "caption", "center", "col", "colgroup", "dd", "details",
  "dialog", "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "head", "header", "hgroup", "hr", "html", "legend", "li", "main", "menu", "nav", "ol", "optgroup", "option", "p",
  "pre", "search", "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "ul",
]);
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

// GitHub の本文・コメントで参照になる記法。広めに拾い、原文と出現順を守る。
const githubAtoms = new RegExp([
  /\[\^[^\]\r\n]+\](?::)?/u.source,
  /(?<![\w&\\/.-])(?:[\w.-]+\/[\w.-]+)?#\d+/u.source,
  /(?<![\w\\-])GH-\d+/u.source,
  /(?<![\w.+@\\-])@[\w-]+(?:\/[\w-]+)?/u.source,
  /(?<![\w\\/.-])(?:[\w.-]+(?:\/[\w.-]+)?@)?[a-f\d]{7,40}(?![\w])/u.source,
  /(?<![\w\\]):[\w+-]+:/u.source,
].join("|"), "gimu");
// GitHub の消毒でタグが消え、中の文字だけが残る要素。その周囲の空白は比較から除かない。
const removedElements = new Set([
  "address", "article", "aside", "body", "caption", "center", "col", "colgroup", "dialog", "dir", "fieldset",
  "figcaption", "figure", "footer", "form", "head", "header", "hgroup", "html", "legend", "main", "menu", "nav",
  "optgroup", "option", "search",
]);

const gfmParserOptions = {
  extension: {
    table: true, strikethrough: true, autolink: true, tasklist: true, footnotes: true,
    mathDollars: true, mathCode: true, alerts: true,
  },
  parse: { leaveFootnoteDefinitions: true },
};

export const flavors = Object.freeze({
  glfm: Object.freeze({
    parserOptions,
    renderOptions: { ...parserOptions, render: { unsafe: true } },
    frontMatterOpening: /^(---|\+\+\+|;;;)[\w.+-]*[ \t]*$/u,
    // 従来どおり、markdownlint の既定値またはプロジェクトの設定を使う。
    lintFrontMatter: /((^---[^\S\r\n\u2028\u2029]*$[\s\S]+?^---\s*)|(^\+\+\+[^\S\r\n\u2028\u2029]*$[\s\S]+?^(\+\+\+|\.\.\.)\s*)|(^\{[^\S\r\n\u2028\u2029]*$[\s\S]+?^\}\s*))(\r\n|\r|\n|$)/m,
    overrideLintFrontMatter: false,
    atoms: gitlabAtoms,
    descriptionProjection: true,
    descriptionHint: /^[ \t>]*[:~][ \t]/mu,
    unconvertibleHeading: /^#+\d/u,
    blockElements,
    whitespaceElements,
    protectTitledAlerts: false,
  }),
  gfm: Object.freeze({
    parserOptions: gfmParserOptions,
    renderOptions: {
      ...gfmParserOptions,
      extension: { ...gfmParserOptions.extension, tagfilter: true },
      render: { unsafe: true },
    },
    frontMatterOpening: /^(---)[ \t]*$/u,
    lintFrontMatter: /^---[ \t]*(?:\r\n|\r|\n)(?:[\s\S]*?(?:\r\n|\r|\n))?---[ \t]*(?:(?:\r\n|\r|\n)|$)/u,
    overrideLintFrontMatter: true,
    atoms: githubAtoms,
    descriptionProjection: false,
    descriptionHint: null,
    unconvertibleHeading: /^#+\d/u,
    // title は tagfilter でエスケープされて文字になるので、ブロック要素として扱わない。
    blockElements: new Set([...blockElements].filter((name) => !removedElements.has(name) && name !== "title")),
    whitespaceElements,
    protectTitledAlerts: true,
  }),
});

export function getFlavor(name = "glfm") {
  if (typeof name !== "string" || !Object.hasOwn(flavors, name)) {
    throw new Error("方言は gfm か glfm を指定してください。");
  }
  return flavors[name];
}
