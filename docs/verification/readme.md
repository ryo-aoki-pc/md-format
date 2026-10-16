# 検証記録

[README](../../README.md) / [設計](../reference/readme.md) / [ルール一覧](../reference/rules.md)

## 移設・CLI・導入・リストを詰めることの検証（2026-10-16）

対象はコミット `29adff8`（LazyVimStarter の `custom` の 7826bd8 の `tools/glfm-format` から移し、CLI `mdfmt`・導入スクリプト・
loose のリストを詰める分類 `tight_lists` を足した版）。方言は GLFM だけ。

### 環境

- Windows 11 Pro 10.0.26300、Node.js 26.10.0。シェルは pwsh 7.6.6・Windows PowerShell 5.1.26100.9444・cmd・Git Bash（bash 5.3.15）
- abiko-pi: Raspberry Pi 5（4 コア・8 GB）の AlmaLinux 10.2（aarch64）、Node.js 22.23.2
- 依存は `package-lock.json` のまま（comrak 0.48.0-rc.0・markdownlint-cli2 0.23.3・js-beautify 2.0.3）
- 導入は、どちらのホストでも `node scripts/setup.mjs --install-dir <一時のフォルダ> --bin-dir <一時のフォルダ>` で行った（本物の
  `%LOCALAPPDATA%\md-format`・`~/.local/bin` には入れていない）
- 文書の集まり: docs リポジトリの 9 つのサブモジュールの `*.md` 224 本と、setup-notes の `almalinux-setup.md` の 15,092 行の版（計 225 本。
  利用者の手元の文書の写し）
- GitLab の描画は gitlab.com（19.6.0-pre）の Markdown API（`POST /api/v4/markdown`、`gfm: true`）。トークンは環境変数 `GITLAB_TOKEN` から
  読み、送ったのは試験用に作った文書だけ

### 自動テスト

- Windows: `npm test` の 167 件のうち 166 件が成功し、1 件を飛ばした（読めない子フォルダの試験。Windows では読めなくできない）
- abiko-pi: 167 件のうち 166 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` と `git diff --check` が通った

### 移す前と出力が変わらないこと

7826bd8 の整形器（`node format.mjs --runtime-dir <依存>`）と、この版の `format.mjs` を、文書の集まりの 225 本に 1 本ずつ別のプロセスで
かけ、標準出力と成否を比べた。この版で足した分類 `tight_lists` は外した（`--disable-fixes tight_lists`）。

| 分類 | 同じ | 違う | 整形で変わった文書 |
| --- | ---: | ---: | ---: |
| 既定 | 225 | 0 | 120 |
| 全部（既定で無効の `heading_conversion`・`emphasis_spaces`・`reversed_links`・`unused_definitions` も有効） | 225 | 0 | 120 |

全部を有効にしても違いが出なかったので、「緩い確かめだけで当てる修正が、リストを loose にしていた」文書は、この集まりには無かった
（その形は `test/lists.test.mjs` の試験で確かめる）。

### リストを loose にしないこと・loose のリストを詰めること

既定の分類（`tight_lists` を含む）で 225 本を整形し、前と後を比べた。

- 誤り 0。2 回目の整形で変わる文書 0
- Comrak の HTML の描画は、段落を包む `<p>` を除いて、225 本すべてで同じ（`normalizedHtml` で比べた）
- tight だったリストが loose になったもの 0。整形で変わった文書は 168 本
- loose のリスト 733 個のうち 715 個を詰めた。残った 18 個は、どれも詰めると構造が変わるもの
  - 13 個: 項目の中に HTML のブロック（`<details>` など）がある。HTML のブロックは空行まで続くので、後ろの空行を消すとフェンスや
    リストがブロックの中に入る（setup-notes の `ai-agents.md`）
  - 4 個: 1 つの項目に段落が 2 つある（つなぐと 1 つの段落になる）
  - 1 個: 入れ子のリストの後に段落が続く（空行を消すと、入れ子のリストの項目の続きになる）
- 試験用に作った文書（記号・番号・タスク・入れ子・引用の中・フェンスのある項目と、段落が 2 つの項目のリスト）を GitLab の
  Markdown API で前後とも描いた。`<li>` の直後の `<p>` が 14 から 2 になり（残る 2 は段落が 2 つの項目のリスト）、それと
  `data-sourcepos` などの位置の属性・脚注の id のほかに違いは無かった

### CLI

導入した起動役を PATH の先頭に置き、試験用の文書（`#  見出し` と行末の空白）で確かめた。

| 確かめたこと | pwsh 7.6.6 | Windows PowerShell 5.1 | cmd | Git Bash |
| --- | --- | --- | --- | --- |
| 選ばれる起動役 | `mdfmt.ps1` | `mdfmt.ps1` | `mdfmt.cmd` | `mdfmt`（sh） |
| ファイル 1 つを標準出力へ（0） | 成功 | 成功 | 成功 | 成功 |
| 標準入力から（0） | 試していない | 試していない | 成功 | 成功 |
| `--check <フォルダ>` は整形の要るファイルの名前を出して 1 | 成功 | 成功 | 成功 | 成功 |
| `--write <フォルダ>` は書き換えて名前を出して 0、その後の `--check` は 0 | 成功 | 成功 | 試していない | 成功 |
| 日本語の名前・BOM・CRLF を保って書き換える | 成功 | 成功 | 試していない | 成功 |
| UTF-8 でないファイル（Shift_JIS）は `mdfmt:` で始まる誤りで 2、ファイルは変えない | 成功 | 成功 | 成功 | 成功 |
| 名前に `&`・空白を含むファイル | 成功 | 成功 | 成功（引用符で囲む） | 成功 |
| 名前に `%TEMP%` を含むファイル | 成功 | 成功 | 試していない | 成功 |
| `--version`（版と導入したコミット）・`--help` | 成功 | 成功 | 試していない | `--version` だけ成功 |
| `--write` だけ（ファイル無し）は 2 | 成功 | 成功 | 試していない | 試していない |
| 出力の先が先に閉じても（`mdfmt --check docs \| head -1`）例外を出さない | 試していない | 試していない | 試していない | 成功 |

- PowerShell では、標準入力へのパイプは文字コードや改行を変えるので試していない（README でファイルを渡すよう案内している）
- cmd は、コマンドラインの `%名前%` を自分で展開するので、名前に `%TEMP%` を含むファイルはそのまま渡せない（mdfmt の外の決まり）

### 導入

- Windows・abiko-pi とも、一時のフォルダへの新規の導入と、同じフォルダへの導入し直し（入れ替え）が通った。`--check` は、導入先と
  起動役が合っていれば `導入済み: mdfmt 0.1.0 / <コミット>（<起動役>）` を出して 0 で終わった
- 起動役のフォルダが PATH に無いときは、導入も `--check` も `問題: <フォルダ> が PATH にありません。…` を出して 1 で終わった。
  導入先が無いときは `問題: 導入されていません: <導入先>` と、起動役が導入先と合わない `問題:` を出して 1 で終わった
- 古い Neovim の整形器の依存（`%LOCALAPPDATA%\nvim-data\glfm-format`）が残っていると、`注意:` で消してよいことを案内した（消さない）
- 途中で失敗したときに今の導入が残ること、2 つ同時に動かしたときの鍵、npm の見つけ方は、`test/setup.test.mjs` の試験で確かめた

### 速さ

[bench/bench.mjs](../../bench/bench.mjs) で測った。1 回ずつ空回しした後、比べるものを交互に動かし、中央値と最も遅い値を出す。文書は標準入力に渡し、
起動役はファイルを引数に渡した。文書は 1 行の文書・LazyVimStarter の README（386 行）・上の 15,092 行の文書。Windows では、ほかのアプリ（OneDrive・
同期・検索など）の負荷が 15〜25% かかったままで、回ごとの揺れが大きかった。

Windows（中央値。カッコは最も遅い値）:

| 文書（回数） | 7826bd8 | この版（`tight_lists` 無効） | この版（既定） |
| --- | ---: | ---: | ---: |
| 1 行（10 回） | 257 ms（298） | 258 ms（350） | 257 ms（416） |
| README 386 行（15 回） | 336 ms（384） | 339 ms（377） | 345 ms（395） |
| 15,092 行（15 回） | 5,652 ms（7,223） | 5,343 ms（7,544） | 6,391 ms（7,834） |

abiko-pi（中央値。カッコは最も遅い値）:

| 文書（回数） | 7826bd8 | この版（`tight_lists` 無効） | この版（既定） |
| --- | ---: | ---: | ---: |
| 1 行（10 回） | 624 ms（637） | 632 ms（654） | 634 ms（642） |
| README 386 行（10 回） | 1,115 ms（1,153） | 1,113 ms（1,167） | 1,044 ms（1,066） |
| 15,092 行（5 回） | 13,391 ms（13,462） | 13,447 ms（13,580） | 16,482 ms（16,498） |

- `tight_lists` を外した既定の経路は、7826bd8 と比べて、揺れの内だった（Windows で -5〜+1%、abiko-pi で -0.2〜+1.3%）
- `tight_lists` は、loose のリストの多い 15,092 行の文書（201 個を詰める）で、Windows で 13%・abiko-pi で 23% 遅くなった。README では増えなかった
  （abiko-pi では 6% 速かった）
- 詰めたリストに markdownlint（MD031・MD032）が空行を足す修正を、文書を解析し直さずに外すようにする前は、この 15,092 行の文書の先頭 3,000 行で
  60 秒・解析 1,470 回かかった（外した後は 0.9 秒・解析 12 回）

起動役の分（Windows。中央値、10 回。15,092 行は 5 回）:

| 文書 | `node format.mjs` | `mdfmt.cmd` | `mdfmt.ps1`（Windows PowerShell 5.1） | `mdfmt`（Git Bash） |
| --- | ---: | ---: | ---: | ---: |
| 1 行 | 257 ms | 294 ms | 616 ms | 319 ms |
| README 386 行 | 356 ms | 409 ms | 736 ms | 400 ms |
| 15,092 行 | 6,206 ms | 5,665 ms | 6,856 ms | 5,659 ms |

- `mdfmt.ps1` は、Windows PowerShell 5.1 の起動の分（約 360 ms）だけ遅い。起動済みの PowerShell から呼ぶときは、この分はかからない
- abiko-pi の sh の起動役（`mdfmt`）は、1 行で 624 ms・README で 1,034 ms・15,092 行で 16,560 ms（`node format.mjs` の既定と同じ）
- フォルダの `--check`（setup-notes の `docs` の 102 本を 1 つのプロセスで）: Windows で 9,220 ms（中央値、10 回。負荷の軽いときに測った別の回は 7,412 ms）

### この検証で未検証のこと

- macOS
- 本物の導入先（`%LOCALAPPDATA%\md-format`・`~/.local/share/md-format`・`~/.local/bin`）への導入と、`git pull` での更新（setup-notes の
  手順を実機で通したときに、setup-notes-verification に記録する）
- Neovim からの整形（LazyVimStarter の検証記録に記録する）
- cmd の `--write`・BOM・CRLF と、PowerShell の標準入力

## GFM 対応の検証（2026-10-16）

対象はコミット `0d57ad1`（GFM の方言と、`--flavor`・`.md-format.json` を足した版。この後、上の節の検証記録の上に載せ直した）。環境と文書の集まりは、上の節と同じ。GitHub の描画は
GitHub の Markdown API（`POST /markdown`。gh 2.102.0 の認証）で、送ったのは試験用に作った文書だけ。

### 自動テスト

- Windows: `npm test` の 202 件のうち 201 件が成功し、1 件を飛ばした
- abiko-pi: 202 件のうち 201 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` と `git diff --check` が通った

### GLFM の出力が変わらないこと

上の節と同じ比べ（7826bd8 の整形器と、`tight_lists` を外したこの版の GLFM の既定）で、既定の分類も全部の分類も、225 本すべてで出力が同じだった。

### GitHub の描画で確かめた GFM の決まり（2026-10-15）

`flavors.mjs` の GFM の値は、試験用の文書を GitHub の Markdown API で描いて決めた。`mode=gfm`（Issue やコメントの描画）で見たもの:

- タスク: `[ ]`・`[x]`・`[X]` はタスクになり、`[~]` はただの文字になる（Comrak の `relaxedTasklistMatching` を使わない）
- 数式: `$x^2$` と ``$`y`$`` は数式になる
- alerts: `> [!note]`（小文字）も alerts になる。種類の後に題を書いた `> [!NOTE] 題` と、リストや引用の中に入れ子にした alerts は、普通の引用になる
  （Comrak はどちらも alerts と読むので、GFM ではその範囲を修正しない）
- tagfilter: `<title>`・`<iframe>` などは、文字としてエスケープされる
- HTML の消毒: `section`・`details`・`div`・本物の表の部品は残る。`address`・`article`・`aside`・`header`・`footer`・`nav`・`main`・`figure`・
  `figcaption`・`form`・`fieldset` などは、タグが消えて中の文字が残る（そのまわりの空白は描画に出る）。表の外の `td`・`tr` などと `</hr>` も、タグが消える。
  `style`・`class` の属性は消え、`id` には `user-content-` が付く
- 段落の中の改行は、`mode=gfm` では `<br>` になり、`mode=markdown`（文書の描画）では改行のまま。ただし `mode=markdown` は、タスク・alerts・数式・参照を描かない
- `@octocat` は `mode=gfm` でユーザーへのリンクになる（`#1`・`GH-1`・コミットの SHA は、`context` の `ryo-aoki-pc/md-format` に当たるものが無いので、リンクにならない）

### 整形の前と後の描画

試験用の文書 3 本（front matter・見出し・リスト・alerts（小文字・題つき・入れ子）・タスク・表・数式・脚注・参照・行頭の `: `・`+++` の行・
`<header>` や `<nav>` を含む HTML・`<details>`・HTML の表、loose のリストなど）を、この版で GFM として整形し、前と後を GitHub の API で描いた。

- `mode=gfm`（`<br>` と改行の違いを除く）と `mode=markdown` の両方で、`tight_lists` を外したときは 3 本とも描画が同じだった
- `tight_lists` を有効にすると、loose のリストのある 1 本で、`<li>` の直後の `<p>` が無くなったことだけが違った
- loose のリストを集めた文書（上の節の試験用の文書）は、`mode=markdown` で `<li>` の直後の `<p>` が 16 から 2 になり、ほかは同じだった

### 文書の集まりを GFM で整形する

文書の集まりの 225 本を `--flavor gfm`・既定の分類で整形し、前と後を Comrak の GFM の解析と描画（tagfilter つき）で比べた。

- 誤り 0。2 回目の整形で変わる文書 0。描画は、段落を包む `<p>` を除いて 225 本すべてで同じ
- tight だったリストが loose になったもの 0。loose のリストの 715 個を詰め、18 個が残った（理由は GLFM と同じ）。整形で変わった文書は 168 本

### 速さ

上の節と同じ測り方。GLFM の既定は、上の節の版（PR 1 の先端）と比べた。

| 文書（回数） | 上の節の版（既定） | この版（既定、GLFM） | この版（`--flavor gfm`） |
| --- | ---: | ---: | ---: |
| Windows 1 行（10 回） | 257 ms | 267 ms | 265 ms |
| Windows README 386 行（10 回） | 356 ms | 354 ms | 342 ms |
| Windows 15,092 行（5 回） | 6,206 ms | 5,871 ms | 6,309 ms |
| abiko-pi 1 行（10 回） | 634 ms | 628 ms | 627 ms |
| abiko-pi README 386 行（10 回） | 1,044 ms | 1,047 ms | 1,045 ms |
| abiko-pi 15,092 行（5 回） | 16,482 ms | 16,607 ms | 16,109 ms |

- GLFM の既定は、上の節の版と揺れの内で同じ。GFM も同じくらい（Windows は負荷の揺れが大きい）

### この検証で未検証のこと

- GitHub のリポジトリのファイル表示（blob）での描画（API の `mode=markdown` と `mode=gfm` で代わりに確かめた）
- 実在する Issue・コミットへの参照のリンク

## 長い行の折り返しの検証（2026-10-16）

対象はコミット `63d9af6`（分類 `line_length` を足した版。この後、上の節の検証記録の上に載せ直した）。環境と文書の集まりは、上の節と同じ。

### 自動テスト

- Windows: `npm test` の 217 件のうち 216 件が成功し、1 件を飛ばした
- abiko-pi: 217 件のうち 216 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` と `git diff --check` が通った

### 既定（折り返さない）で出力が変わらないこと

上の節と同じ比べ（7826bd8 の整形器と、`tight_lists` を外したこの版の GLFM の既定）で、既定の分類も全部の分類も、225 本すべてで出力が同じだった。

### 文書の集まりを折り返す

文書の集まりの 225 本を、既定の分類に `line_length` を足して（GLFM。幅は各リポジトリの markdownlint の設定。無ければ 80）整形し、前と後を比べた。
この確かめの `format.mjs` は、`63d9af6` と同じもの。

- 誤り 0。2 回目の整形で変わる文書 0。Comrak の描画は、段落を包む `<p>` と空白の違いを除いて、225 本すべてで同じ
- tight だったリストが loose になったもの 0（詰めたリストは 715 個で、`line_length` の無いときと同じ）
- MD013 の報告は 20,755 行から 6,996 行になった。残った行の内訳:
  - 表 3,903 行・コードブロック 2,691 行・見出し 19 行（どれも折らない）
  - 段落 383 行。どれも折れる所が無い（日本語どうしの間の空白しか無い、コードスパン・リンクの行き先・守る記法の中にしか空白が無い、
    閉じないインラインの HTML のタグの後ろ、折ると次の行の頭がリストの印や `|` になる、など）。折れそうな空白のある行を機械的に拾った 5 行も、
    1 行ずつ見て、どれもこの理由に当たった
- 15,092 行の文書は、Windows で 6.3 秒・解析 20 回（ライブラリとして 1 回。詰めたリストに markdownlint が空行を足す修正を、解析し直さずに外すようにする前は、600 秒を越えていた）

### 描画の比べ（GitHub・GitLab）

試験用に作った文書（英語・日本語と英語の混ざった行・日本語どうしの空白・リスト・番号付き・引用・`<kbd>` のある行・コードスパン・リンク・参照・
脚注・alerts）を、`line_length` を有効に（幅 60）して整形し、前と後を描いた。

- GitHub の Markdown API（`mode=markdown`）: GFM として整形したものの描画が同じ
- GitLab の Markdown API（`gfm: true`）: GLFM として整形したものの描画が、脚注の id（描くごとの乱数）を除いて同じ。GitLab は、段落の中の改行を
  `<br>` にしない
- GitHub の Issue・Pull Request・コメント（`mode=gfm`）は、段落の中の改行を `<br>` にするので、折り返すと描画が変わる（文書に書いた）

### 速さ

上の節と同じ測り方。

| 文書（回数） | 既定 | `line_length` を有効 |
| --- | ---: | ---: |
| Windows 1 行（10 回） | 262 ms | 253 ms |
| Windows README 386 行（10 回） | 340 ms | 363 ms |
| Windows 15,092 行（5 回） | 5,348 ms | 6,650 ms |
| abiko-pi 1 行（10 回） | 624 ms | 630 ms |
| abiko-pi README 386 行（10 回） | 1,053 ms | 1,149 ms |
| abiko-pi 15,092 行（5 回） | 16,508 ms | 20,759 ms |

- 既定（`line_length` は無効）の経路は、上の節までの版と変わらない（同じ回に測った 7826bd8 は、Windows の 15,092 行で 4,878 ms、
  この版の `tight_lists` を外した既定で 4,971 ms）
- `line_length` を有効にすると、15,092 行の文書（1,359 行が長すぎる）で、Windows で 24%・abiko-pi で 26% 遅くなった

### この検証で未検証のこと

- Firefox などのブラウザで、全角の文字の間の改行が消えることそのもの（CSS Text の決まりと Firefox の実装の説明から、全角の文字どうしの間では折らない）
- 幅に MD013 の `strict`・`stern` を使った文書の集まり（試験の単体だけ）

## Markdown をはさむ HTML の字下げの検証（2026-10-16）

対象は、`8f55375` に、Markdown をはさむ HTML の開きと閉じの字下げをそろえる変更を足した版（この節を足したコミット）。比べる前の版は `8f55375`。

### 環境

- Windows 11 Pro 10.0.26300、Node.js 26.10.0
- abiko-pi: Raspberry Pi 5 の AlmaLinux 10.2（aarch64）、Node.js 22.23.2
- 依存は `package-lock.json` のまま（comrak 0.48.0-rc.0・markdownlint-cli2 0.23.3・js-beautify 2.0.3）
- 文書の集まりは、上の節と同じ 225 本
- GitHub の描画は Markdown API（`gh api markdown`、`mode=markdown`）、GitLab の描画は gitlab.com の Markdown API（`gfm: true`）。送ったのは試験用に作った文書だけ

### 自動テスト

- Windows: `npm test` の 238 件のうち 237 件が成功し、1 件を飛ばした
- abiko-pi: 238 件のうち 237 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` と `git diff --check` が通った

### 前の版と出力を比べる

`8f55375` の `format.mjs` と、この版の `format.mjs` を、同じ依存（`--runtime-dir`）で文書の集まりの 225 本に 1 本ずつ別のプロセスでかけ、標準出力と成否を比べた（既定の分類）。

- 同じ 224 本、違う 1 本。誤り 0
- 違った 1 本は、md-table-excel の `docs/verification/excel-check.md` の、Markdown のセルがある HTML の表。前の版では、`<td>` が 6 つ字下げされ、`</td>`・`</tr>` は 0、後ろの `<tr>` の中の `<td>` は 2 だった。
  この版では、表の部品がすべて 0 で、セルの中の `<pre>` だけが 2。2 回目の整形で変わらず、Comrak の描画は前の版の出力と同じ
- `<details>` の中に Markdown を書いた文書（5 本・32 個）は、前の版と同じ出力

### 試験用の文書で確かめた形

試験用に作った文書を整形し、開きと閉じの字下げがそろうこと、2 回目の整形で変わらないことを確かめた。

- Markdown のセルがある表（`thead`・`<pre>` のセル）、前の版のずれた出力、リスト（`- `・`1. `・リストの印の行から始まる表・`10. `）と引用の中の表、改行が CRLF の文書、GFM
- `<details>` の中で Markdown をはさむ `<div>`、入れ子の `<details>`、Markdown をはさむ `<ul>`・`<dl>`
- レビューで見つかった形（どれも試験に足した）:
  - Markdown をはさむ `<details>` の中の、1 つのブロックで閉じる表（中を字下げする）、Markdown のセルの次の断片の 1 行目の入れ子の表（中を字下げする）
  - セルの中の複数行のコメント、`style="white-space: pre"` の要素と `<xmp>` の中の行（字下げを変えない）、`<script>` の文字列の中の `</details>`（タグと読まずにそろえる）
  - 閉じない `<p>` の後ろの表（整形する）、閉じない要素を閉じる後ろのブロックと、閉じない `<table>` の部品だけのまとまり（変えない）
  - `<script>` の中の文字の `<table>` の後ろにある、表の外の改行を変える整形（拒む。前の版も拒んでいた）、1 つのブロックの中の開きの無い閉じタグ（前の版と同じ出力）
- 表でない要素（`<ul>`・`<dl>` など）は、Markdown をはさむ要素だけを入れ物の字下げに置くので、兄弟の `<li>` などとは字下げが違う（開きと閉じはそろう）

### 描画の比べ（GitHub・GitLab）

上の試験用の文書 2 本を整形し、前と後を描いた。

- GitHub の Markdown API: GFM として整形したものの描画が、描画に出ない空白の違いを除いて同じ
- GitLab の Markdown API: GLFM として整形したものの描画が、`data-sourcepos` と描画に出ない空白の違いを除いて同じ

### 速さ

上の節と同じ測り方（Windows。中央値）。

| 文書（回数） | 前の版 | この版 |
| --- | ---: | ---: |
| 1 行（10 回） | 250 ms | 248 ms |
| README 248 行（10 回） | 297 ms | 308 ms |
| `excel-check.md` 44 行（10 回） | 354 ms | 366 ms |
| 15,092 行（5 回） | 7,283 ms | 7,276 ms |
| 閉じない `<p>` のブロックが 1,500 個並ぶ 6,000 行（5 回） | 1,256 ms | 1,355 ms |

- 最後の行は、閉じない要素の後ろから数え直すことが最も多い形

### この検証で未検証のこと

- Neovim の保存の整形そのもの。LazyVimStarter の試験（`tests/md_format_conform.lua`）の入力は、CLI で前の版と同じ出力だった
- abiko-pi での速さ

## 生の文字の要素と空要素の比べ方の検証（2026-10-16）

対象は、`da73315` に、HTML の描画の比べ方（`normalizedHtml`）で生の文字の要素の中をタグとして読まないようにし、空要素の `white-space` の扱いを直した版（この節を足したコミット）。比べる前の版は `da73315`。

### 直した穴

前の版は、次の形で描画の変わる整形を当てていた（どれも試験用に作った文書で確かめた）。

- `<xmp>` の中の `<div><p>本文</p></div>` を、タグとして字下げした。xmp は中の文字を空白ごとそのまま描く
- `<div style="white-space: pre"><iframe></div></iframe>hello   world</div>` の `hello   world` を `hello world` に詰めた。iframe の中の偽の `</div>` で、空白をそのまま出す要素の追跡が外れていた
- `<div><pre/>a   b</pre></div>` と `<span style="white-space: pre"/>a   b</span>` の `a   b` を詰めた。HTML では、空要素でない要素の `/` は無視され、要素は開く
- `<img src="a.png" style="white-space: pre">` のような空要素の `white-space` で、後ろのすべての HTML のブロックの整形を拒んでいた（厳しすぎる側）

この版の読み方:

- 生の文字の要素（script・style・textarea・title・xmp・iframe・noembed・noframes・noscript・plaintext）の中は、対応する閉じタグまでを文字として読む。閉じタグは、名前の直後が ASCII の空白・`/`・`>` のときだけ。script は、HTML の escaped・double escaped の状態も追う。plaintext は閉じない。xmp・plaintext・textarea の中の空白は原文のまま比べる
- noscript と、svg・math の中の同じ名前の要素では、中のタグも要素になる。そのため、生の文字の要素がある HTML は、前の版と同じくタグとして読む値も作り、両方で比べる。生の文字としてだけ読むと、前の版が拒んでいた `<noscript>` の中の `<div style="white-space: pre">a   b</div>` を詰める整形を当てた
- 空要素は `white-space` を書いても空白をそのまま出す要素に数えない（svg・math の中を除く）。空要素でない要素は `/>` でも開くと数える

### 環境

- Windows 11 Pro 10.0.26300、Node.js 26.10.0
- abiko-pi: Raspberry Pi 5 の AlmaLinux 10.2（aarch64）、Node.js 22.23.2
- 依存は `package-lock.json` のまま（comrak 0.48.0-rc.0・markdownlint-cli2 0.23.3・js-beautify 2.0.3）
- 文書の集まりは、上の節と同じ 225 本
- GitHub の描画は Markdown API（`gh api markdown`、`mode=markdown`）、GitLab の描画は gitlab.com の Markdown API（`gfm: true`）。送ったのは試験用に作った文書だけ

### 自動テスト

- Windows: `npm test` の 241 件のうち 240 件が成功し、1 件を飛ばした
- abiko-pi: 241 件のうち 240 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` と `git diff --check` が通った
- この版の `test/html.test.mjs` を前の版の `format.mjs` にかけると、35 件のうち 5 件が落ちた（足した試験が、直した穴を見分ける）

### 前の版と出力を比べる

`da73315` の `format.mjs` と、この版の `format.mjs` を、同じ依存（`--runtime-dir`）で文書の集まりの 225 本に 1 本ずつ別のプロセスでかけ、標準出力と成否を比べた（既定の分類）。

- GLFM: 同じ 225 本、違う 0 本。誤り 0
- GFM（`--flavor gfm`）: 同じ 225 本、違う 0 本。誤り 0
- 変わらないのは、225 本を Comrak で描いた HTML（GLFM と GFM の設定）に、生の文字の要素の開きタグ・`white-space` を書いた style・空要素でない要素の `/>` が 1 つも無いため。文書の中の `<script>` などは、どれもコードの中にある

### 試験用の文書で確かめた形

- 上の「直した穴」の形は、どれも変えない（GLFM・GFM）。空要素の `white-space` の後ろのブロックは整形し、2 回目の整形で変わらない
- `<pre>` の中の `<xmp><!--</xmp>-->`（コメントに似た文字が閉じタグを隠さない）、`</xmp >`（閉じタグにならない）、引用が閉じない属性の閉じタグ（残りを生の文字にする）、
  script の二重のエスケープ（`<script><!--<script></script></div></script>` の中の `</div>` は文字）、svg・math の中の `<title>`・`<textarea>`・`<link>`、
  `<math></svg>`（違う名前の閉じタグは math を閉じない）を試験に足した。script の二重のエスケープと `<math></svg>` は、レビューで見つかった形
- 説明リスト・番号付きリストの中の表（1 行の表と、Markdown のセルをはさむ表の 30 通り）は、前の版と同じ出力

### 描画の比べ（GitHub・GitLab）

上の穴の形を並べた文書を、前の版で整形したものと元の文書を描いた。

- GitLab: xmp のタグを消して中を文字として描くので、前の版の字下げが文字の間の空白として見えた。`<pre/>` を開いた `<pre>` として描くので、`a   b` が `a b` になった。iframe・span の形は、style を消すので見えなかった
- GitHub: xmp と iframe はタグをエスケープし、`<pre/>` は閉じた `<pre></pre>` として描き、style を消すので、どれも見えなかった
- この版は、これらの形を変えない
- noscript: GitHub・GitLab とも、noscript のタグを消して中を HTML として描いた（GitLab は `</noscript>` の後ろの文字を `<b>` で包み直した）。タグとして読む値も比べる理由
- 空要素の `white-space` の後ろのブロックを整形した文書: GitHub（GFM）・GitLab（GLFM）とも、描画に出ない空白の違いを除いて、整形の前と同じ

### 速さ

上の節と同じ測り方（Windows。中央値）。

| 文書（回数） | 前の版 | この版 |
| --- | ---: | ---: |
| 1 行（10 回） | 231 ms | 237 ms |
| README 248 行（10 回） | 281 ms | 282 ms |
| `excel-check.md` 44 行（10 回） | 327 ms | 331 ms |
| 15,092 行（5 回） | 4,909 ms | 4,900 ms |
| `<div><p>…</p></div>` のブロックが 1,500 個並ぶ 3,001 行（5 回） | 613 ms | 618 ms |
| 同じ文書の先頭に `<textarea>` を足した 3,003 行（5 回） | 605 ms | 622 ms |

- 最後の行は、生の文字の要素があり、文書全体の比べを 2 つの読み方で行う形

### この検証で未検証のこと・残る穴

- 次の 2 つは、前の版からある穴で、この版でも残る
  - タグの名前の直後の `/` の後が `>` でない開きタグ（`<xmp/foo>` など）を、タグとして読まない（`htmlTokens` の読み方）
  - `<listing>` を空白をそのまま描く要素に数えていない（`whitespaceElements`）。`<listing>a   b</listing>` を詰める整形を当てる
- script の escaped などの状態は、HTML のブロックをまたいで持ち越さない（文書全体の描画の比べで見分ける）
- Neovim の保存の整形そのもの
- abiko-pi での速さ
