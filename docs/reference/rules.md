# GLFM 整形器のルール一覧

保存時と `<leader>cf` の Markdown の整形 (`glfm_markdownlint`、[format.mjs](../../format.mjs)) が、
markdownlint の各ルールで Markdown をどう変えるかの一覧。埋め込んだ HTML の整形は、最後の [HTML のブロック](#html-のブロック) にある。

- 整形する対象は、[lua/plugins/lang-markdown.lua](../../lua/plugins/lang-markdown.lua) の `format_fixes` の表で選ぶ。
  下の分類名かルール名 (`MD026`・`no-trailing-punctuation`) を `true`・`false` にする。書かない分類は既定のまま。
  ルール名の指定は分類の指定より優先する。名前の大文字小文字は区別しない。プロジェクトのカスタムルールも、その名前で選べる (既定で有効)
- `format_fixes` は整形だけを選ぶ。markdownlint の診断 (nvim-lint) は変わらない。診断ごと止めるときは、同じファイルの `disabled_rules` に書く
- どの設定でも、Comrak で読んだ構造 (見出し・段落・リストの所属と開始番号・強調・リンク・強制改行など) が変わる修正と、
  GitLab の記法 (`#123`・`~label`・`@user` などの参照・`[[_TOC_]]` と wiki のリンク・`::include`・画像の `{width=…}` など) を変える修正は当てない。
  ただし、見出し・強調・リンクを作る修正 (`heading_conversion`・`emphasis_spaces`・`reversed_links`) は、有効にすると構造を変えて当てる
- 知らない名前や、同じルールを有効と無効の両方に書いたときは、整形せずにエラーにする (バッファは変わらない)
- 例は markdownlint の既定の設定 (全ルール有効) で整形した結果。`␣` は空白、`⇥` はタブを表す (見えない文字を見えるようにするため)。
  [test/reference.test.mjs](../../test/reference.test.mjs) が、この文書の例をすべて整形し直して確かめる

## 一覧

| ルール | 分類 | 既定 | 変えること |
| --- | --- | --- | --- |
| [MD018](#md018-no-missing-space-atx) no-missing-space-atx | `heading_conversion` | 無効 | `#` の後に空白を足して見出しにする |
| [MD019](#md019-no-multiple-space-atx) no-multiple-space-atx | `heading_spacing` | 有効 | `#` の後の余分な空白を消す |
| [MD020](#md020-no-missing-space-closed-atx) no-missing-space-closed-atx | `heading_conversion` | 無効 | `#見出し#` に空白を足して見出しにする |
| [MD021](#md021-no-multiple-space-closed-atx) no-multiple-space-closed-atx | `heading_spacing` | 有効 | 前後の `#` の内側の余分な空白を消す |
| [MD022](#md022-blanks-around-headings) blanks-around-headings | `blank_lines` | 有効 | 見出しの前後に空行を足す |
| [MD023](#md023-heading-start-left) heading-start-left | `heading_spacing` | 有効 | 見出しの前の空白を消す |
| [MD026](#md026-no-trailing-punctuation) no-trailing-punctuation | `heading_punctuation` | 有効 | 見出しの末尾の句読点を消す |
| [MD009](#md009-no-trailing-spaces) no-trailing-spaces | `whitespace` | 有効 | 行末の空白を消す |
| [MD010](#md010-no-hard-tabs) no-hard-tabs | `whitespace` | 有効 | タブを空白にする |
| [MD047](#md047-single-trailing-newline) single-trailing-newline | `whitespace` | 有効 | ファイルの末尾に改行を足す |
| [MD012](#md012-no-multiple-blanks) no-multiple-blanks | `blank_lines` | 有効 | 続く空行を 1 つにする |
| [MD031](#md031-blanks-around-fences) blanks-around-fences | `blank_lines` | 有効 | コードブロックの前後に空行を足す |
| [MD032](#md032-blanks-around-lists) blanks-around-lists | `blank_lines` | 有効 | リストの前後に空行を足す |
| [MD058](#md058-blanks-around-tables) blanks-around-tables | `blank_lines` | 有効 | 表の前後に空行を足す |
| [MD004](#md004-ul-style) ul-style | `lists` | 有効 | 箇条書きの記号を揃える |
| [MD005](#md005-list-indent) list-indent | `lists` | 有効 | 同じ階層の項目の字下げを揃える |
| [MD007](#md007-ul-indent) ul-indent | `lists` | 有効 | 入れ子の箇条書きの字下げを直す |
| [MD029](#md029-ol-prefix) ol-prefix | `lists` | 有効 | 番号を振り直す |
| [MD030](#md030-list-marker-space) list-marker-space | `lists` | 有効 | 記号の後の空白を 1 つにする |
| [MD027](#md027-no-multiple-space-blockquote) no-multiple-space-blockquote | `blockquotes` | 有効 | `>` の後の余分な空白を消す |
| [MD049](#md049-emphasis-style) emphasis-style | `emphasis_style` | 有効 | 強調の記号を揃える |
| [MD050](#md050-strong-style) strong-style | `emphasis_style` | 有効 | 太字の記号を揃える |
| [MD037](#md037-no-space-in-emphasis) no-space-in-emphasis | `emphasis_spaces` | 無効 | 強調の記号の内側の空白を消す |
| [MD014](#md014-commands-show-output) commands-show-output | `code` | 有効 | (コードの中身なので当てない) |
| [MD038](#md038-no-space-in-code) no-space-in-code | `code` | 有効 | (コードの中身なので当てない) |
| [MD034](#md034-no-bare-urls) no-bare-urls | `link_style` | 有効 | URL を `<…>` で囲む |
| [MD054](#md054-link-image-style) link-image-style | `link_style` | 有効 | リンクの書き方を揃える (設定したときだけ) |
| [MD039](#md039-no-space-in-links) no-space-in-links | `link_text` | 有効 | リンクの文字の端の空白を消す |
| [MD051](#md051-link-fragments) link-fragments | `link_fragments` | 有効 | 文書の中の見出しへのリンクの大文字小文字を直す |
| [MD011](#md011-no-reversed-links) no-reversed-links | `reversed_links` | 無効 | `(文字)[URL]` をリンクにする |
| [MD053](#md053-link-image-reference-definitions) link-image-reference-definitions | `unused_definitions` | 無効 | 使っていない参照定義の行を消す |
| [MD060](#md060-table-column-style) table-column-style | `tables` | 有効 | 表の列の書き方を揃える |
| [MD044](#md044-proper-names) proper-names | `proper_names` | 有効 | 固有名詞の大文字小文字を直す (名前を設定したときだけ) |

自動修正の無いルール: MD001 MD003 MD013 MD024 MD025 MD028 MD033 MD035 MD036 MD040 MD041 MD042 MD043 MD045 MD046 MD048 MD052 MD055 MD056 MD059。
診断だけで、整形では変えない。

markdownlint を上げてルールが増えたときは、[format.mjs](../../format.mjs) の分類の表に足すまで、そのルールの修正は当てない。

## 見出し

### MD018 no-missing-space-atx

分類 `heading_conversion`、既定で無効。`#` の後に空白の無い行に空白を足して、見出しにする。

変わらない (既定):

```markdown 変わらない
#見出し
```

`heading_conversion = true` のとき、整形前:

```markdown 整形前 fixes=heading_conversion
#見出し
```

整形後:

```markdown 整形後
# 見出し
```

`#` の直後が数字の行は、GitLab の課題の参照 (`#123`) なので、有効にしても見出しにしない。段落の続きの行も、`##1` のように `#` が続く行も同じ。

変わらない (`heading_conversion = true` でも):

```markdown 変わらない fixes=heading_conversion
#123 の対応

関連する課題
#456 で修正した
```

### MD019 no-multiple-space-atx

分類 `heading_spacing`、既定で有効。

整形前:

```markdown 整形前
#␣␣見出し
```

整形後:

```markdown 整形後
# 見出し
```

### MD020 no-missing-space-closed-atx

分類 `heading_conversion`、既定で無効。前後を `#` で囲んだ行に空白を足して、見出しにする。

`heading_conversion = true` のとき、整形前:

```markdown 整形前 fixes=heading_conversion
#見出し#
```

整形後:

```markdown 整形後
# 見出し #
```

既にある見出しは変えない (`# C#` を `# C #` にすると、見出しの文字が `C` になる)。`#` の直後が数字の行も見出しにしない。

変わらない (`heading_conversion = true` でも):

```markdown 変わらない fixes=heading_conversion
# C#

#123 と #
```

見出しでない行の末尾の `#` は、閉じの `#` とみなす。`#C#` は、見出しの文字が `C` になる (`C#` という見出しにするなら、`# C#` と書く)。

`heading_conversion = true` のとき、整形前:

```markdown 整形前 fixes=heading_conversion
#C#
```

整形後:

```markdown 整形後
# C #
```

### MD021 no-multiple-space-closed-atx

分類 `heading_spacing`、既定で有効。

整形前:

```markdown 整形前
#␣␣見出し␣␣#
```

整形後:

```markdown 整形後
# 見出し #
```

### MD022 blanks-around-headings

分類 `blank_lines`、既定で有効。

整形前:

```markdown 整形前
# 見出し
本文
```

整形後:

```markdown 整形後
# 見出し

本文
```

tight なリストの中の見出しには空行を足さない (リストが loose になり、項目に `<p>` が付くため)。

変わらない:

```markdown 変わらない
- a
  ## 見出し
- b
```

### MD023 heading-start-left

分類 `heading_spacing`、既定で有効。

整形前:

```markdown 整形前
␣␣# 見出し
```

整形後:

```markdown 整形後
# 見出し
```

### MD026 no-trailing-punctuation

分類 `heading_punctuation`、既定で有効。見出しの末尾の `.,;:!。，；：！` を消す (見出しの文字が変わる。GitLab の見出しの ID は変わらない)。

整形前:

```markdown 整形前
## 注意:

本文
```

整形後:

```markdown 整形後
## 注意

本文
```

## 空白

### MD009 no-trailing-spaces

分類 `whitespace`、既定で有効。

整形前:

```markdown 整形前
一行目␣
二行目
```

整形後:

```markdown 整形後
一行目
二行目
```

行末の空白 3 つは強制改行 (`<br>`) なので、消さない。

変わらない:

```markdown 変わらない
一行目␣␣␣
二行目
```

### MD010 no-hard-tabs

分類 `whitespace`、既定で有効。

整形前:

```markdown 整形前
名前⇥値
```

整形後:

```markdown 整形後
名前 値
```

項目の続きの段落の字下げのタブは、空白 1 つにすると段落が項目から外れるので、変えない。

変わらない:

```markdown 変わらない
- 項目

⇥続きの段落
```

### MD047 single-trailing-newline

分類 `whitespace`、既定で有効。ファイルの最後の行に改行が無ければ足す (下の整形前は、`最後の行` の後に改行が無い)。

整形前:

```markdown 整形前 末尾の改行なし
最後の行
```

整形後:

```markdown 整形後
最後の行
```

## 空行

### MD012 no-multiple-blanks

分類 `blank_lines`、既定で有効。

整形前:

```markdown 整形前
段落



次の段落
```

整形後:

```markdown 整形後
段落

次の段落
```

### MD031 blanks-around-fences

分類 `blank_lines`、既定で有効。

整形前:

~~~markdown 整形前
本文
```
コード
```
本文
~~~

整形後:

~~~markdown 整形後
本文

```
コード
```

本文
~~~

### MD032 blanks-around-lists

分類 `blank_lines`、既定で有効。

整形前:

```markdown 整形前
本文
- 項目
```

整形後:

```markdown 整形後
本文

- 項目
```

### MD058 blanks-around-tables

分類 `blank_lines`、既定で有効。

整形前:

```markdown 整形前
本文
| a | b |
| - | - |
| 1 | 2 |
```

整形後:

```markdown 整形後
本文

| a | b |
| - | - |
| 1 | 2 |
```

## リスト

### MD004 ul-style

分類 `lists`、既定で有効。同じリストの記号は、全部まとめて変えるか、まとめて見送る。

整形前:

```markdown 整形前
* 親
  - 子
* 次
```

整形後:

```markdown 整形後
* 親
  * 子
* 次
```

記号の違う 2 つのリストは、記号を揃えると 1 つの loose なリストにつながるので、変えない。

変わらない:

```markdown 変わらない
* 一

+ 二
```

### MD005 list-indent

分類 `lists`、既定で有効。

整形前:

```markdown 整形前
1. 一
␣1. 二
```

整形後:

```markdown 整形後
1. 一
1. 二
```

### MD007 ul-indent

分類 `lists`、既定で有効。

整形前:

```markdown 整形前
- 親
␣␣␣␣- 子
```

整形後:

```markdown 整形後
- 親
␣␣- 子
```

### MD029 ol-prefix

分類 `lists`、既定で有効。同じリストの番号は、全部まとめて変えるか、まとめて見送る。

整形前:

```markdown 整形前
1. 一
3. 二
4. 三
```

整形後:

```markdown 整形後
1. 一
2. 二
3. 三
```

1 以外から始まるリストは、振り直すと開始番号が変わるので、変えない。

変わらない:

```markdown 変わらない
3. 三
4. 四
5. 五
```

### MD030 list-marker-space

分類 `lists`、既定で有効。

整形前:

```markdown 整形前
-␣␣␣項目
```

整形後:

```markdown 整形後
- 項目
```

空白を減らすと、項目の外にあった段落が項目に入るときは、変えない。

変わらない:

```markdown 変わらない
-␣␣␣項目

␣␣␣外の段落
```

## 引用

### MD027 no-multiple-space-blockquote

分類 `blockquotes`、既定で有効。

整形前:

```markdown 整形前
>␣␣引用
```

整形後:

```markdown 整形後
> 引用
```

## 強調

### MD049 emphasis-style

分類 `emphasis_style`、既定で有効。最初の強調の記号に揃える。

整形前:

```markdown 整形前
_強調_ と *強調*
```

整形後:

```markdown 整形後
_強調_ と _強調_
```

語の中の `_` は強調にならないので、語の中の強調は変えない。

変わらない:

```markdown 変わらない
_強調_ と 日本*語*です
```

### MD050 strong-style

分類 `emphasis_style`、既定で有効。最初の太字の記号に揃える。

整形前:

```markdown 整形前
__太字__ と **太字**
```

整形後:

```markdown 整形後
__太字__ と __太字__
```

変わらない:

```markdown 変わらない
__太字__ と 日本**語**です
```

### MD037 no-space-in-emphasis

分類 `emphasis_spaces`、既定で無効。強調の記号の内側の空白を消して、強調にする。

変わらない (既定):

```markdown 変わらない
これは ** 強調 ** です

2 * 3 * 4 になる
```

`emphasis_spaces = true` のとき、整形前:

```markdown 整形前 fixes=emphasis_spaces
これは ** 強調 ** です
```

整形後:

```markdown 整形後
これは **強調** です
```

有効にすると、掛け算の `*` も強調にする (強調を作る修正なので、構造の検査では正しい修正と見分けられない)。

`emphasis_spaces = true` のとき、整形前:

```markdown 整形前 fixes=emphasis_spaces
2 * 3 * 4 になる
```

整形後:

```markdown 整形後
2 *3* 4 になる
```

## コード

### MD014 commands-show-output

分類 `code`、既定で有効。コードブロックの `$` を消す修正で、コードの中身を変えるので当てない。

変わらない:

~~~markdown 変わらない
```sh
$ ls
$ pwd
```
~~~

### MD038 no-space-in-code

分類 `code`、既定で有効。コードスパンの中の空白を消す修正で、コードの中身を変えるので当てない。

変わらない:

```markdown 変わらない
`␣コード` と `コード␣`
```

## リンク

### MD034 no-bare-urls

分類 `link_style`、既定で有効。

整形前:

```markdown 整形前
見る https://example.com を
```

整形後:

```markdown 整形後
見る <https://example.com> を
```

scheme の無い URL は、`<…>` で囲むと autolink にならず `<` と `>` が表示されるので、囲まない。

変わらない:

```markdown 変わらない
見る www.example.com を
```

### MD054 link-image-style

分類 `link_style`、既定で有効。markdownlint の設定でリンクの書き方を禁止したときだけ働く。

markdownlint の設定:

```json markdownlint
{ "MD054": { "url_inline": false } }
```

整形前:

```markdown 整形前
[https://example.com](https://example.com)
```

整形後:

```markdown 整形後
<https://example.com>
```

表示名や題名が消える書き換えは当てない。

markdownlint の設定:

```json markdownlint
{ "MD054": { "inline": false } }
```

変わらない:

```markdown 変わらない
[説明](https://example.com "題名")
```

### MD039 no-space-in-links

分類 `link_text`、既定で有効。リンクの文字の端の ASCII の空白を消す。

整形前:

```markdown 整形前
[␣リンク␣](https://example.com)
```

整形後:

```markdown 整形後
[リンク](https://example.com)
```

全角空白は表示に出るので、消さない。

変わらない:

```markdown 変わらない
日本[　語　](https://example.com)です
```

### MD051 link-fragments

分類 `link_fragments`、既定で有効。

整形前:

```markdown 整形前
# Heading

[戻る](#Heading)
```

整形後:

```markdown 整形後
# Heading

[戻る](#heading)
```

### MD011 no-reversed-links

分類 `reversed_links`、既定で無効。`(文字)[URL]` を `[文字](URL)` のリンクにする (`(注)[1]` のような、リンクのつもりでない文字もリンクにする)。

変わらない (既定):

```markdown 変わらない
(注)[https://example.com] を見る
```

`reversed_links = true` のとき、整形前:

```markdown 整形前 fixes=reversed_links
(注)[https://example.com] を見る
```

整形後:

```markdown 整形後
[注](https://example.com) を見る
```

### MD053 link-image-reference-definitions

分類 `unused_definitions`、既定で無効。使っていない参照定義の行と、重複した定義の行を消す (表示は変わらないが、本文の行が消える)。

変わらない (既定):

```markdown 変わらない
本文

[1]: https://example.com
```

`unused_definitions = true` のとき、整形前:

```markdown 整形前 fixes=unused_definitions
本文

[1]: https://example.com
```

整形後:

```markdown 整形後
本文
```

## 表

### MD060 table-column-style

分類 `tables`、既定で有効。markdownlint の設定で `style` を決めたときに主に働く。

markdownlint の設定:

```json markdownlint
{ "MD060": { "style": "compact" } }
```

整形前:

```markdown 整形前
|a|b|
|-|-|
|1|2|
```

整形後:

```markdown 整形後
| a | b |
| - | - |
| 1 | 2 |
```

## 固有名詞

### MD044 proper-names

分類 `proper_names`、既定で有効。markdownlint の設定で `names` を決めたときだけ働く。

markdownlint の設定:

```json markdownlint
{ "MD044": { "names": ["JavaScript"] } }
```

整形前:

```markdown 整形前
javascript を使う
```

整形後:

```markdown 整形後
JavaScript を使う
```

GitLab のラベルの参照 (`~"javascript"`) の中は変えない (参照先が変わるため)。

変わらない:

```markdown 変わらない
ラベル ~"javascript" の課題
```

## HTML のブロック

分類 `html`、既定で有効。markdownlint のルールではないので、上の一覧の表には入れない。止めるときは `format_fixes` に `html = false` と書く。

- 行頭のタグで始まり空行で終わる HTML のブロックを、[js-beautify](https://github.com/beautifier/js-beautify) でタグの入れ子に合わせて 2 つずつ字下げする。
  ブロック要素 (`<tr>`・`<td>`・`<li>` など) は 1 行ずつにし、インライン要素 (`<b>`・`<code>` など) と文の行は分けない。折り返さない
- 整形の前後で、Comrak の HTML の描画 (描画に出ない空白の違いを除く)・Markdown の構造・GitLab の記法が変わらないブロックだけを直す。
  `<pre>`・`<textarea>`・`<code>`・`<kbd>`・`<samp>` の中の空白は変えない。インライン要素どうしの間の空白の有無も変えない
- HTML の中に Markdown を書くとき (空行で区切る) は、HTML の断片ごとに整形し、間の Markdown と空行は変えない。
  断片の 1 行目は入れ物の字下げのままにする (4 つ以上字下げすると、空行の後ではコードブロックになるため)。そのため、閉じタグだけの断片は行頭に並ぶ
- 段落の中のインライン HTML、`<pre>`・`<script>`・`<style>`・`<textarea>` で始まるブロック、コメントのブロックは変えない

### 表

整形前:

```markdown 整形前
<table><tr><td>a</td><td>b</td></tr></table>
```

整形後:

```markdown 整形後
<table>
  <tr>
    <td>a</td>
    <td>b</td>
  </tr>
</table>
```

セルの中の `<br>`・`<code>`・`<pre>` と属性は変えない。`<pre>` の中の字下げもそのまま。

整形前:

```markdown 整形前
<table><thead><tr><th>キー</th><th>説明</th></tr></thead><tbody><tr><td><code>a  b</code></td><td colspan="2">一行目<br>二行目</td></tr><tr><td><pre>  x
    y</pre></td></tr></tbody></table>
```

整形後:

```markdown 整形後
<table>
  <thead>
    <tr>
      <th>キー</th>
      <th>説明</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>a  b</code></td>
      <td colspan="2">一行目<br>二行目</td>
    </tr>
    <tr>
      <td>
        <pre>  x
    y</pre>
      </td>
    </tr>
  </tbody>
</table>
```

### 入れ子の表

整形前:

```markdown 整形前
<table>
<tr><td><table><tr><td>入れ子</td></tr></table></td></tr>
</table>
```

整形後:

```markdown 整形後
<table>
  <tr>
    <td>
      <table>
        <tr>
          <td>入れ子</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

### セルの中の Markdown

開きの断片は字下げし、セルの中の Markdown と閉じの断片は変えない。

整形前:

```markdown 整形前
<table>
<tr>
<td>

- セルの中の **Markdown**

</td>
</tr>
</table>
```

整形後:

```markdown 整形後
<table>
  <tr>
    <td>

- セルの中の **Markdown**

</td>
</tr>
</table>
```

### 折りたたみ

`<summary>` を 2 つ字下げする。本文の Markdown と空行は変えない。

整形前:

```markdown 整形前
<details>
<summary>概要</summary>

本文 **太字**

</details>
```

整形後:

```markdown 整形後
<details>
  <summary>概要</summary>

本文 **太字**

</details>
```

Markdown をはさんだ入れ子は、内側の断片も行頭から字下げする。

整形前:

```markdown 整形前
<details>
<summary>外</summary>

<details>
<summary>内</summary>

内の本文

</details>

</details>
```

整形後:

```markdown 整形後
<details>
  <summary>外</summary>

<details>
  <summary>内</summary>

内の本文

</details>

</details>
```

### 入れ物の中

リスト・引用の中のブロックは、入れ物の字下げや `>` を保って字下げする。

整形前:

~~~markdown 整形前
1. 手順

   <details>
   <summary>貼るコマンド</summary>

   ```bash
   ls
   ```

   </details>

> <table><tr><td>引用の中</td></tr></table>
~~~

整形後:

~~~markdown 整形後
1. 手順

   <details>
     <summary>貼るコマンド</summary>

   ```bash
   ls
   ```

   </details>

> <table>
>   <tr>
>     <td>引用の中</td>
>   </tr>
> </table>
~~~

### 変えないもの

段落の中のインライン HTML・パイプの表・`<pre>` で始まるブロック・コメントのブロックは変えない。
脚注の定義の行に続けて書いた 1 行の HTML も変えない (続きの行の字下げが 1 行目と違い、行に分けると 2 回目の整形で字下げが変わるため)。

変わらない:

```markdown 変わらない
段落の中の <span>インライン</span> HTML。

| パイプ | 表 |
| --- | --- |
| <b>a</b> | b<br>c |

<pre>
  そのまま
</pre>

<!-- markdownlint-disable MD033 -->

本文[^1]

[^1]: <div><p>脚注</p></div>
```

## loose のリストを詰める

分類 `tight_lists`、既定で有効。markdownlint のルールではないので、上の一覧の表には入れない。止めるときは `tight_lists` を無効にする。

- 項目の間か、1 つの項目の中のブロックの間に空行のあるリスト (loose のリスト) は、項目の段落が `<p>` で包まれ、項目の間が広く描かれる。
  その空行を消して、詰まった (tight の) リストにする。描画で変わるのは、項目の段落を包む `<p>` が無くなることだけ
- 消すのは、となり合う項目の間と、1 つの項目の中のとなり合うブロックの間の空行 (引用の中では `>` だけの行) だけ。
  コード・HTML・数式のブロックの中の空行と、最後の項目の後の空行は消さない。入れ子のリストは、それぞれのリストで判断する
- 詰めると段落がつながるもの (1 つの項目に段落が続けて 2 つある) や、ブロックが変わるもの (段落の後の字下げのコードなど) は、loose のまま残す
- 当てた後の Markdown の構造が、そのリストの tight のほかはノードごとに同じものだけを当てる。範囲を指定したときは、範囲に収まるリストだけを詰める
- この分類を有効にしても無効にしても、どの修正も、詰まったリストを loose にしない。MD031 (`list_items`) や MD032 が項目の中に空行を足す修正は当てない。
  診断を消すときは、markdownlint の設定に `"MD031": { "list_items": false }` と書く

### 項目の間

整形前:

```markdown 整形前
- 一つ目

- 二つ目

1. 手順

2. 確認
```

整形後:

```markdown 整形後
- 一つ目
- 二つ目

1. 手順
2. 確認
```

### 項目の中のブロックの間

整形前:

~~~markdown 整形前
- 説明

  - 入れ子

- 手順

  ```bash
  ls
  ```

> - 引用の中
>
> - 二つ目
~~~

整形後:

~~~markdown 整形後
- 説明
  - 入れ子
- 手順
  ```bash
  ls
  ```

> - 引用の中
> - 二つ目
~~~

### 変えないもの

1 つの項目に段落が 2 つあるリストと、段落の後に字下げのコードがあるリストは、詰めると構造が変わるので変えない。

変わらない:

```markdown 変わらない
- 一つ目の段落

  二つ目の段落
- 次

<!-- 区切り -->

- 段落

      字下げのコード
- 次
```
