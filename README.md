# md-format

GFM と GLFM の Markdown を、描画を変えずに整形する CLI（mdfmt）。

## 整形の例

保存時と `<leader>cf` で、Markdown は次のように変わる。例は markdownlint の既定 (全ルール有効) で整形した結果で、`␣` は空白を表す。
ルールごとの例と、直す対象の選び方は [整形のルール一覧](docs/reference/rules.md) にある。
この節の例は、`test/reference.test.mjs` が整形し直して確かめる。

見出しの `#` の後の余分な空白・見出しの後の空行・行末の空白・続く空行を直す (MD019・MD022・MD009・MD012)。

整形前:

```markdown 整形前
#␣␣見出し
本文の行末に空白␣



次の段落
```

整形後:

```markdown 整形後
# 見出し

本文の行末に空白

次の段落
```

箇条書きの記号を最初のものに揃え、入れ子の字下げを 2 つにし、番号を振り直す。リストの前に空行を足す (MD004・MD007・MD029・MD030・MD032)。

整形前:

```markdown 整形前
本文
* 親
␣␣␣␣+ 子
*␣␣␣次

1. 一
3. 二
4. 三
```

整形後:

```markdown 整形後
本文

* 親
  * 子
* 次

1. 一
2. 二
3. 三
```

強調と太字の記号を最初のものに揃え、リンクの文字の端の空白を消し、裸の URL を `<…>` で囲む (MD049・MD050・MD039・MD034)。

整形前:

```markdown 整形前
*強調* と _強調_、**太字** と __太字__

[␣リンク␣](https://example.com) と https://example.com を見る
```

整形後:

```markdown 整形後
*強調* と *強調*、**太字** と **太字**

[リンク](https://example.com) と <https://example.com> を見る
```

GitLab の記法は変えない。`#123` は見出しにせず、説明リストの対応と内部のリストの字下げ・数式・目次・ラベルとユーザーの参照もそのまま。

変わらない:

```markdown 変わらない
#123 の対応

用語
: 説明

  - 内部の項目

数式 $`a^2`$ と [[_TOC_]] と ~label と @user
```

埋め込んだ HTML の表は、`<tr>`・`<th>`・`<td>` ごとの行に分け、入れ子に合わせて 2 つずつ字下げする。セルの中の `<kbd>`・`<br>` と文は 1 行のまま。

整形前:

```markdown 整形前
<table><tr><th>キー</th><th>説明</th></tr><tr><td><kbd>Ctrl</kbd>+<kbd>J</kbd></td><td>日本語入力の切り替え<br>挿入モードで使う</td></tr></table>
```

整形後:

```markdown 整形後
<table>
  <tr>
    <th>キー</th>
    <th>説明</th>
  </tr>
  <tr>
    <td><kbd>Ctrl</kbd>+<kbd>J</kbd></td>
    <td>日本語入力の切り替え<br>挿入モードで使う</td>
  </tr>
</table>
```

折りたたみ (`<details>`) は `<summary>` を 2 つ字下げする。中に書いた Markdown の本文と、その前後の空行は変えない。

整形前:

```markdown 整形前
<details>
<summary>詳しい手順</summary>

- 一つ目
- 二つ目

</details>
```

整形後:

```markdown 整形後
<details>
  <summary>詳しい手順</summary>

- 一つ目
- 二つ目

</details>
```
