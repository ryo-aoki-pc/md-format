# md-format

GFM と GLFM の Markdown を、描画を変えずに整形する `mdfmt` コマンド。

導入・使い方・更新の手順は、setup-notes の [windows-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md)（Windows 11）と [almalinux-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md)（AlmaLinux 10）にある（[集約対応表](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/dev/consolidation-map.md)）。
ルールごとの例は [docs/reference/rules.md](docs/reference/rules.md)、設計は [docs/reference/readme.md](docs/reference/readme.md)、検証記録は [docs/verification/readme.md](docs/verification/readme.md) にある。

## できること

- markdownlint（markdownlint-cli2）の自動修正のうち、整形の前後で描画が変わらないものだけを当てる。
  修正を当てた文書を Comrak（GitLab と同じ系統の解析器）で読み直し、構造・リテラル・GitLab の記法が変わる修正は当てない
- loose のリスト（項目の間に空行のあるリスト）を詰めて tight にする。どの修正も、詰まったリストを loose にしない
- 有効にすると、長すぎる行を既にある空白の位置で折る（分類 `line_length`。幅は markdownlint の MD013 の設定）
- 埋め込んだ HTML のブロック（`<table>`・`<details>` など）を、タグの入れ子に合わせて字下げする
- 直す対象を、分類名かルール名（`MD026`・`no-trailing-punctuation`）で選べる
- 標準入力・ファイル・フォルダを扱える。`--check` で、整形の要るファイルを見つけられる
- Neovim（[LazyVimStarter](https://github.com/ryo-aoki-pc/LazyVimStarter)）の保存時の整形も、導入した mdfmt を使う

## 導入

Node.js 22 以上と npm が要る。clone して、導入スクリプトを実行する。

```sh
git clone https://github.com/ryo-aoki-pc/md-format.git ~/md-format
node ~/md-format/scripts/setup.mjs
node ~/md-format/scripts/setup.mjs --check
```

- 依存はリポジトリの外（Linux は `${XDG_DATA_HOME:-~/.local/share}/md-format`、Windows は `%LOCALAPPDATA%\md-format`、macOS は `~/Library/Application Support/md-format`）に入る
- 起動役 `mdfmt` は `~/.local/bin`（Windows は `%USERPROFILE%\.local\bin`）に置く。PATH に無ければ `--check` が知らせる
- Windows の起動役は 3 つ: PowerShell 用の `mdfmt.ps1`、cmd 用の `mdfmt.cmd`、Git Bash 用の `mdfmt`。PowerShell は `.ps1` を選ぶ
  （実行ポリシーが RemoteSigned のとき。setup-notes の手順で設定する）
- cmd の `mdfmt.cmd` は、引数の `&`・`%名前%` などを cmd が解釈する。そうした文字を含むファイル名は、PowerShell か Git Bash から渡す
- 更新は `git -C ~/md-format pull --ff-only` の後に、導入スクリプトを実行し直す
- 導入先を使っている Neovim があると、Windows では入れ替えられないことがある。そのときは Neovim を閉じてやり直す

## 使い方

```sh
mdfmt < 入力.md > 出力.md        # 標準入力を整形して標準出力に書く
mdfmt 文書.md                    # 1 つのファイルを整形して標準出力に書く（ファイルは変えない）
mdfmt --write docs README.md     # 変わるファイルを書き換える（フォルダは中の *.md）
mdfmt --check docs               # 整形の要るファイルの名前を出す（あれば終了コード 1）
mdfmt --disable-fixes tight_lists,MD026 文書.md
mdfmt --help
```

- 終了コードは 0（成功）・1（`--check` で整形の要るファイルがあった）・2（誤り）。1 つのファイルの誤りで止めずに、残りを扱う
- フォルダは、その下の `*.md` を名前順に扱う。`.git`・`node_modules`・`.` で始まるフォルダと、フォルダの中のシンボリックリンク（ファイルもフォルダも）は除く
- 引数に渡したシンボリックリンクはたどる。`--write` は、リンクの先のファイルを書き換える（リンクはそのまま）
- ファイルは UTF-8 として読む。UTF-8 でなければ変えずに誤りにする。BOM と改行（LF・CRLF）は保つ
- markdownlint の設定（`.markdownlint.jsonc`・`.markdownlint-cli2.jsonc` など）は、markdownlint-cli2 と同じく探す。
  ファイルが今のフォルダの下にあれば、今のフォルダを基準にする
- 1 回の実行で複数のファイルを扱うと、markdownlint の JS の設定やカスタムルールは 1 回だけ読み込まれる（状態を持つカスタムルールは、ファイルごとに `mdfmt` を動かす）
- PowerShell（5.1 と 7）では、パイプやリダイレクトが文字コードや改行を変えることがある。ファイルを渡して `--write` か `--check` で使う
- 標準入力の文書の名前は `--filename` で渡せる（設定を探す場所になる。既定は今のフォルダの `stdin.md`）

## 直す対象の選び方

`--enable-fixes`・`--disable-fixes` に、分類名かルール名をカンマで区切って渡す。ルール名の指定は分類の指定より強い。
分類と既定の一覧は [docs/reference/rules.md](docs/reference/rules.md) にある。markdownlint のルールでない分類は次の 2 つ。

- `tight_lists`（既定で有効）: loose のリストを詰める
- `html`（既定で有効）: HTML のブロックを字下げする

既定で無効の分類のうち、`line_length`（MD013）は長すぎる行を空白の位置で折る。幅は markdownlint の MD013 の `line_length`（既定 80）。
日本語どうしの間の空白では折らない（ブラウザによって空白が見えなくなるため）。有効にするには `--enable-fixes line_length` か、
`.md-format.json` の `"fixes": { "line_length": true }`。

診断（markdownlint の警告）ごと止めるときは、markdownlint の設定でルールを無効にする。

## 方言の選び方

既定は GLFM（GitLab Flavored Markdown）。GitHub 向けの文書は `--flavor gfm` で、GFM（GitHub Flavored Markdown）として整形する。

```sh
mdfmt --flavor gfm --write README.md
```

プロジェクトで揃えるときは、`.md-format.json` を置く。キーは `flavor` と `fixes` だけで、どちらも省ける。

```json
{
  "flavor": "gfm",
  "fixes": { "MD026": false }
}
```

- 文書のフォルダから上へたどり、最初に見つけた `.md-format.json` だけを読む（フォルダを渡したときも、文書ごとに探す）
- 標準入力では `--filename` のフォルダ、無ければ今のフォルダから探す
- `--flavor` は `.md-format.json` より強い。どちらも無ければ GLFM
- `fixes` は分類名かルール名を真偽値で選ぶ（`--enable-fixes`・`--disable-fixes` と同じ）。引数のルール名 → 引数の分類 → 設定のルール名 → 設定の分類 → 既定の順に決める
- 壊れた JSON・知らないキー・不正な値は、設定ファイルのパスを添えた誤り（終了コード 2）になる
- `fixes` の知らない名前は、警告（`mdfmt: 警告: …`）を 1 回の実行に 1 行だけ出して無視する。カスタムルールの名前は、その文書の診断に出た名前と照合するので、診断の出なかった文書でも警告になる
- どちらの方言も、段落の中の改行は、リポジトリのファイルと同じく空白として比べる（GitHub のコメントでは改行が強制改行になる）
- 方言ごとに守る記法と例は、[GFM と GLFM の違い](docs/reference/rules.md#gfm-と-glfm-の違い) にある

## Neovim から使う

LazyVimStarter の保存時と `<leader>cf` の整形は、導入した mdfmt（導入先の `format.mjs`）を呼ぶ。Markdown のバッファを開くと、依存を読み込んだ node を 1 つ先に起動しておき（予備のプロセス、`spare.mjs`）、保存の待ち時間を縮める。設定は LazyVimStarter の `lua/plugins/lang-markdown.lua` にある。

## 整形の例

`mdfmt`（と Neovim の保存時の整形）で、Markdown は次のように変わる。例は markdownlint の既定 (全ルール有効) で整形した結果で、`␣` は空白を表す。
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

## テスト

```sh
npm ci --ignore-scripts
npm test
```
