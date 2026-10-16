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

## HTML の表のセルを Markdown にする検証（2026-10-16）

対象は、`f16823a` に分類 `html_cells`（HTML の表の書式のあるセルを Markdown にする。既定で有効）を足した版（この節を足したコミット）。比べる前の版は `f16823a`。

### 環境

- Windows 11 Pro 10.0.26300、Node.js 26.10.0
- abiko-pi: Raspberry Pi 5 の AlmaLinux 10.2（aarch64）、Node.js 22.23.2
- 依存は `package-lock.json` のまま（comrak 0.48.0-rc.0・markdownlint-cli2 0.23.3・js-beautify 2.0.3）。`entities` 8.1.0 を直接の依存に足した（markdownlint-cli2 → markdown-it が既に入れていたもの。lock の差は根の `dependencies` の 1 行で、版と integrity は前と同じ）
- 文書の集まりは、上の節と同じ 225 本
- GitHub の描画は Markdown API（`mode=markdown` と `mode=gfm`）、GitLab の描画は gitlab.com の Markdown API（`gfm: true`）。送ったのは試験用に作った文書だけ
- mdtable（md-table-excel）0.1.0

### 自動テスト

- Windows: `npm test` の 279 件のうち 278 件が成功し、1 件を飛ばした
- abiko-pi: `npm ci --ignore-scripts` の後、279 件のうち 278 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` が通った。Windows で `git diff --check` が通った
- 足した試験: `test/cells.test.mjs` 32 件（要素ごとの置き換え・変えないセル・入れ物・範囲整形・設定と CLI・CRLF・文書の記号に合わせること・2 回目と近道の有無で同じこと）、
  `test/semantic-html.test.mjs` 4 件（比べる正規化）、`test/fast-paths.test.mjs` 1 件（書式の無いセルでは解析も描画もしない・64 個のセルを描画 3 回と解析 2 回で確かめる）、
  `test/reference.test.mjs` 1 件（rules.md の新しい節の見出しと例）
- rules.md の新しい節と README の「整形の例」の例は、`test/reference.test.mjs` が整形し直して確かめる。字下げの試験（`test/html.test.mjs`）は `html_cells` を止めて、今までの入力と期待のまま

### 前の版と出力を比べる

`f16823a` の `format.mjs` と、この版の `format.mjs` を、同じ依存（`--runtime-dir`）で文書の集まりの 225 本に 1 本ずつ別のプロセスでかけ、標準出力と成否を比べた。

- GLFM と GFM（`--flavor gfm`）のどちらも、`--disable-fixes html_cells` を付けたこの版の出力は、225 本すべて前の版と同じ。誤り 0
- 既定（`html_cells` が有効）で変わったのは、どちらの方言も `md-table-excel/docs/verification/excel-check.md` の 1 本だけ。
  `<td><code>dnf</code></td>` が `` `dnf` `` の Markdown のセルに、`<td><pre><code class="language-sh">…</code></pre></td>` が `` ```sh `` のフェンスのセルになった
- 変わった出力も含め、225 本すべてで、この版の出力を整形し直しても変わらない

### 試験用の文書で確かめた形

試験の見本のほかに、次の形を整形して、出力・2 回目の整形・近道の有無・Comrak の描画を確かめた。

- 変える: GLFM の `>>>` の引用の中の表、複数行のセル、`th` と `thead`・`tbody`、属性（`colspan`・`align`）のあるセル、リンクの中の画像、
  段落が 2 つあって詰められない項目の中の表、文書の強調が `_`・`__` のとき（`_a_`・`__b__` にそろう）、文書の箇条書きが `*` のとき
- HTML のまま残す: 引用の怠惰な行にかかるセル、詰められる手順の項目の中の表（先に `tight_lists` がリストを詰める）、`[^1]` や `[[_TOC_]]` を含むセル、
  `<b><i>…</i></b>` の入れ子（中のコードだけを Markdown にする）
- エスケープ: リンクの参照定義と同じ名前の `[foo]` は `\[foo\]`、`$a$` は `\$a\$`、`<br>` の後の `1.`・`#`・`-`・`::include` で始まる文は行を分けずに同じ行に残す
- 番号付きのリストは、0 か 1 から始まるものだけを変える。`<ol start="3">` を `3.` から始めると、markdownlint の MD029（既定の `one_or_ordered`）の診断になった
- 太字だけのセル（`**必須**` だけの段落）は MD036 の診断になるので変えない

### 描画の比べ（GitHub・GitLab）

`<code>`・`<b>`・`<i>`・`<s>`・`<strong>`・`<em>`・`<del>`・リンク・画像・裸の URL・実体参照・`<br>` と `<p>`・入れ子のリスト・`<ol start>`・タスク・`<pre>`・引用・説明リスト・エスケープする記号・`#123`・`@root`・見出し・太字だけのセルを並べた表を、整形の前後で描いた。

- GitHub（`mode=markdown`、リポジトリのファイルと同じ）と GitLab の両方で、セルの中の空行で区切った Markdown が描かれた
- 前後の違いは、計画で許した差だけ: セルの文が `<p>` に包まれる、`b`・`i`・`s` が `strong`・`em`・`del` になる、裸の URL がリンクになる（GitHub は前からリンクにしていた。GitLab は新しくリンクになる）
- 各サービスの飾りの違い: タスクは、前は GitHub も GitLab もチェックボックスを消していたが、後はどちらもタスクのリストとして描いた。
  コードは、GitHub が後で色付けした（GitLab は前後とも色付け）。GitLab は、エスケープした `~`・`$` を `<span data-escaped-char>` で包んだ（見た目は同じ）
- GitHub のコメント（`mode=gfm`）では、`<br>` の後の改行が強制改行にもなり、改行が 2 つに見えた。リポジトリのファイルの描画では起きない
- 説明リストは GLFM の記法なので、GitHub では説明リストにならない（GFM の方言では変えない）
- 見出しを含むセルは変えない。GitLab は Markdown の見出しにだけアンカーを付けて `[[_TOC_]]` に入れ、生の `<h3>` には付けなかった。GitHub は両方に付けた

### mdtable との形

- 整形した `excel-check.md` を mdtable で書き出すと、HTML の表のシートのセルの中身は、整形の前の文書を書き出したときと同じだった。変えずに取り込むと「Markdown は変わりません」
- 書き出したブックで、`` `dnf` `` のセルを `` `dnf` と `yum` `` に変えて取り込んだ文書と、`<td><code>dnf</code> と <code>yum</code></td>` にした文書をこの版で整形したものは、表の部分が同じ行になった（mdtable の書き戻しの形と同じ）

### レビュー

- Grok Build 1.0.52（読み取り専用。差分と全文を写したフォルダーだけを読み、フォルダーは変わらなかった）の指摘 4 件を、整形して確かめた
  - 採った: 比べる正規化が、文字が URL・`www.`・メールの形でないリンク（`<a href="hello">hello</a>`）や、前後が文字に接するリンク（`a<a href="…">https://…</a>b`）まで外していた。
    Comrak が裸の URL をリンクにする形だけを外すように狭め、試験に足した
  - 採った: GLFM で `<td><p>::include{file=…}</p></td>` が、行頭に `::include` のある Markdown になっていた。`::include` は Markdown の行頭でだけ働くので、そのセルを HTML のまま残すようにした
  - 採った: 設計の文書の許す差に `www.` が抜けていた
  - 採らなかった: 同じ形の `[TOC]` も残すべき、という推測。gitlab.com の Markdown API で、HTML の `<td><p>[TOC]</p></td>` も、Markdown のセルの `[TOC]` も、同じ目次になった（描画が変わらない）
  - 採らなかった: 計画の `<ol start="3">` の例が古い（計画はリポジトリの外。rules.md と試験は直した動きと合っている）
- Antigravity CLI 1.4.0 は、割り当てを使い切っていて（`RESOURCE_EXHAUSTED`）、レビューできなかった

### 速さ

上の節と同じ測り方（Windows。`bench/bench.mjs`、中央値、5 回）。同じ PC でほかの作業も動いていたので、上の節より全体に遅い。前の版とこの版は交互に動かした。

| 文書 | 前の版 | この版 |
| --- | ---: | ---: |
| 15,092 行 | 9,710 ms | 9,096 ms |
| `excel-check.md` 44 行 | 518 ms | 566 ms |
| `glfm-format.md` 1,110 行 | 497 ms | 515 ms |
| 書式のあるセルが 300 個ある 304 行の表（初めて変える） | 584 ms | 813 ms |
| 上の表を変えた後の 2,704 行（もう一度整形する） | 574 ms | 578 ms |

- 書式のあるセルの無い文書は、この段で解析も描画もしない（`test/fast-paths.test.mjs`）
- 初めて変えるときの増えた分は、300 個のセルの Markdown をまとめて 1 回描くことと、置き換えた文書と期待の文書を 1 回ずつ描くこと

### この検証で未検証のこと

- Neovim の保存の整形そのもの（LazyVimStarter の配線の試験は、導入を更新した後に通す）
- abiko-pi での速さ

## listing と HTML のタグの読み方の比べ方の検証（2026-10-17）

対象は、`a7df5b7` に、HTML のブロックの比べ方（`normalizedHtml`）で listing・xmp・plaintext の中の空白を保ち、タグを HTML の字句解析と同じ区切りで読むようにした版（この節を足したコミット）。比べる前の版は `a7df5b7`。

### 直した穴

前の版は、次の形で描画の変わる整形を当てるか、描画の違う HTML を同じ値にしていた（どれも試験用に作った文書で確かめた）。

- `<div><listing>a   b</listing></div>` の `a   b` を `a b` に詰め、`<listing>` の中の `<b>a</b>   <i>b</i>` を字下げした。ブラウザの既定のスタイルは、listing・xmp・plaintext を pre と同じ white-space: pre で描く
- `<div style="white-space: pre"><xmp/foo></div></xmp>hello   world</div>` と、`hello world` にしたものを同じ値にした（`<script/foo>` も同じ）。
  HTML では、タグ名の後の `/` は、`>` が続かなければ属性の前の区切りで、xmp は開く。js-beautify の整形では当たらなかった
- `<img src=a.png/>`（src は `a.png/`）を `<img src=a.png />`（src は `a.png`）に、`<a href=x/>y</a>` を `<a href=x />y</a>` にした。比べ方が `/>` の前の空白を消していた。
  GitHub と GitLab でも、画像とリンクの URL が変わった（下の「描画の比べ」）
- 同じ読み方の穴:
  - 属性の間に空白の無いタグ（`<xmp a="b"c>`）、`=` で始まる属性名、名前や引用符の無い値の中の `"`・`'`・`<`・`=`・`` ` ``、英数字と `-` 以外を含むタグ名を、タグと読まなかった。逆に、NBSP などをタグの中の区切りにしていた
  - `</ x>` と `<?x …` の後ろの `<div>` を、ブロック要素のタグと読んだ。HTML では、最初の `>` までの偽のコメント（処理命令）
  - `style` の `white-space` を、`/` や引用符の直後の属性と、実体参照で書いた値（`white&#45;space`）で見落とした
  - 名前を `toLowerCase` で小文字にし、K（U+212A）を k にした（`<blocKquote>` を blockquote と読んだ）
  - noscript の中の `<xmp>a   b</xmp>` と `a b` を同じ値にした。スクリプトを切ったブラウザや、noscript の中を HTML として描くサービスでは、xmp の中の空白が出る
  - svg の `<text xml:space="preserve">a   b</text>` と `a b` を同じ値にした。ブラウザは、この text を white-space: pre で描いた
  - svg・math の中の `<![CDATA[<span>a   b</span> > c]]>` を最初の `>` で切り、後ろを畳む文字として読んだ。svg・math の中の CDATA は、`]]>` までが文字

この版の読み方:

- listing・xmp・plaintext と、`xml:space` のある要素（値によらない）を、空白をそのまま描く要素に数える。listing・xmp・plaintext は、js-beautify にも中を整形しない要素（`content_unformatted`）として渡す
- タグ・コメント・宣言・処理命令・偽のコメントを、HTML の字句解析（WHATWG の data 状態）と同じ区切りで読む。
  CDATA は、HTML の中では最初の `>` までの偽のコメント、svg・math の中では `]]>` までの文字なので、`<![CDATA[` がある HTML は、`]]>` までを 1 つにした読み方の値も作って比べる
- 引用符が閉じないまま文書が終わるタグは、HTML では捨てられる（描かれない）が、文字として比べる（厳しい側）
- CommonMark の文法のタグの形のタグは、名前・属性・閉じの印から組み立て直して比べる。閉じの印の `/` と、引用符の無い値の末尾の `/` を分ける。名前は ASCII の英字だけを小文字にする
- CommonMark の形でないタグ（`<a/href="x">`・`<a href="x"/title="y">` など）は、要素の開きと閉じは WHATWG の読み方で数えるが、比べるときは原文のまま・空白の境にせず、`html_cells` もそのセルを Markdown にしない。
  GitHub がこうしたタグを WHATWG と違う読み方で描くため（下の「描画の比べ」）。前の版は、こうしたタグをタグと読まず、整形を拒んでいた
- 対や字下げの候補作りも同じ読み方を使う。閉じタグの末尾の `/`（`</div/>`）では空要素にしない（HTML はふつうの閉じタグとして閉じる）

### 環境

- Windows 11 Pro 10.0.26300、Node.js 26.10.0
- abiko-pi: Raspberry Pi 5 の AlmaLinux 10.2（aarch64）、Node.js 22.23.2
- 依存は `package-lock.json` のまま（comrak 0.48.0-rc.0・markdownlint-cli2 0.23.3・js-beautify 2.0.3・entities 8.1.0）
- 文書の集まりは、上の節と同じ 225 本
- GitHub の描画は Markdown API（`gh api markdown`、`mode=markdown`）、GitLab の描画は gitlab.com の Markdown API（`gfm: true`）。送ったのは試験用に作った文書だけ
- ブラウザの HTML の解析は、Claude のデスクトップアプリの内蔵ブラウザ（Chrome 152.0.7977.130）の `DOMParser` と `getComputedStyle`

### 自動テスト

- Windows: `npm test` の 285 件のうち 284 件が成功し、1 件を飛ばした
- abiko-pi: `npm ci --ignore-scripts` の後、285 件のうち 284 件が成功し、1 件を飛ばした
- どちらも、全 `.mjs` の `node --check` と `git diff --check` が通った
- 足した試験: `test/html.test.mjs` 5 件（空白をそのまま描く要素の整形・属性の名前と値の記号・CDATA と `xml:space` と noscript・CommonMark の形でないタグの整形・セルの比べの属性の読み方）と、
  今ある試験の組（listing・`/` の区切り・偽のコメント・閉じの印と値の `/`・`--!>` のコメントなど）。`test/cells.test.mjs` 1 件（CommonMark の形でないタグのセル）と、`<img src=a.png/>` のセルが `![](a.png/)` になる組
- この版の `test/html.test.mjs` と `test/cells.test.mjs` を前の版の `format.mjs` にかけると、73 件のうち 7 件が落ちた（足した試験が、直した穴を見分ける）

### ブラウザの HTML の解析と突き合わせる

`htmlTokens`（タグ・コメントなどの区切り）と `htmlTagParts`（タグの名前と属性）を写したものを内蔵ブラウザで動かし、ランダムに作った文書を `DOMParser` の結果と比べた。

- 1 つのタグ（`<q` に、名前の文字と、空白・`/`・`=`・引用符・`<`・`` ` ``・`>`・NBSP・K（U+212A）などを 0〜14 個つなげたもの）の後ろに、閉じない引用符を閉じる文字と `END` を置いた文書 33,000 個:
  最初の要素の名前と属性（名前・値。同じ名前は最初のもの）と、body の文字が、どれも同じだった。属性のあるタグは約 17,000 個、名前の直後の `/` で区切ったタグは約 6,100 個
- コメント・`--!>`・`<!-->`・`<!--->`・`<!`・`<?`・`</`・`</>`・`</ b>`・`<!DOCTYPE x>`・タグなどの断片を 1〜12 個並べた文書 33,000 個: body の文字（タグ・コメントなどを除いた文字）が、どれも同じだった
- 文書の先頭には文字 `X` を置いた（文書の先頭の空白は、HTML の解析が body の前で捨てるため）
- 前の版の正規表現で同じ文書（10,000 個ずつ）を読むと、タグの文書の 8,816 個、断片の文書の 7,131 個で body の文字が違った（突き合わせが穴を見分ける）

### 前の版と出力を比べる

`a7df5b7` の `format.mjs` と、この版の `format.mjs` を、同じ依存（`--runtime-dir`）で文書の集まりの 225 本に 1 本ずつ別のプロセスでかけ、標準出力と成否を比べた（既定の分類）。

- GLFM: 同じ 225 本、違う 0 本。誤り 0。この版の出力を整形し直しても、225 本すべて変わらない
- GFM（`--flavor gfm`）: 同じ 225 本、違う 0 本。誤り 0。2 回目でも変わらない
- 変わらないのは、225 本を Comrak で描いた HTML（GLFM と GFM の設定）の約 386,000 個のタグ・コメントで、前の版とこの版の区切りが 1 つも違わず、
  どのタグも CommonMark の形で、listing・xmp・plaintext のタグ、引用符の無い値の末尾の `/`、CDATA、`xml:space` が無いため

### 試験用の文書で確かめた形

- この版の整形: `<div><listing>a   b</listing></div>` は中を保って外を字下げし（`<div>`・`  <listing>a   b</listing>`・`</div>`）、`<listing>` の中のタグは字下げしない。
  `<div><xmp>` の中にタグに似た文字がある形は、前の版は js-beautify が中を字下げして比べで拒んでいたが、この版は中を変えずに外を字下げする
- 変えない形: 上の「直した穴」の形、`<div><p><img src=a.png/></p></div>`、`<div><plaintext>` の後ろ、CommonMark の形でないタグを含むブロックとセル
  （`<a href="u0"/title="v">`・`title="t0"data-x=y` の表・`</div/>` のまとまり。js-beautify が書き直すので比べで拒む）
- 前の版は整形し、この版は変えなくなった形: `<div><p>本文</p/></div>` と `<table><tr><td><b>a</b></td/></tr></table>`。
  前の版は `</p/>`・`</td/>` を `</p />`・`</td />` に書き直していた。この版は CommonMark の形でない閉じタグとして原文のまま比べるので拒む（厳しい側）
- 確かめて前の版と同じだった形: CRLF の文書の複数行のコメント（CRLF のまま整形する）、
  `<img src="a.png" / >` と `<br / >`（HTML でも閉じの印にならず、js-beautify が `/>` に書き直すので拒む）

### 描画の比べ（GitHub・GitLab）

試験用の文書（上の「直した穴」の形、xmp・plaintext を含む div、`</ <div>` と `<?x <div>` の段落、`</div/>` のまとまり、属性の間に空白の無い表）を、元の文書・前の版の出力・この版の出力で描いた。

- この版の出力: GitHub（GFM として整形）・GitLab（GLFM として整形）とも、元の文書と、描画に出ない空白の違いを除いて同じ
- 前の版の出力: `<img src=a.png/>` は、GitHub・GitLab とも画像の URL が `a.png/` から `a.png` に変わった。`<a href=x/>y</a>` は、両方ともリンク先が `x/` から `x` に変わり、GitHub ではリンクの文字がリンクの外に出た
- listing: GitHub・GitLab ともタグを消し、中の文字を div の文字として描いた（空白は畳まれて見える）。前の版の詰めた出力も、見た目は変わらない。listing を描くブラウザや、Comrak の HTML をそのまま描く所では変わる
- GitLab は `<xmp/foo>` を xmp の開きと読んで中の `</div>` を文字にし、`</ <div>` と `<?x <div>` を偽のコメントにした（WHATWG と同じ）
- GitHub は WHATWG と違う読み方をした:
  - `</ <div>` の `<div>` を要素にし、`<xmp/foo>` の中の `</div>` で div を閉じた。この版の比べ方は、原文のまま比べるか、2 つの読み方の両方で比べるので、GitHub の読み方に対しても厳しい側
  - `/` で区切った属性を落とした: `<a/href="u0" title="v">x</a>` はリンクごと消え、`<img/src="a.png" alt="x">` は src が消え、`<a href="u0"/title="v">x</a>` は title が消えた。
    `<a href="u0"title="v">`（引用符の後に空白なし）・`<img src="a.png"alt="x">`・`<a href=u0/ title="v">` は、ふつうの書き方と同じだった（GitLab はどれも WHATWG と同じ）。
    CommonMark の形でないタグを原文のまま比べ、セルを Markdown にしないのは、このため（js-beautify が `<a /href="u0">` のように書き直すと、GitHub では描画が変わりうる）
- gitlab.com の Markdown API は、最後のコミットの後に一時的に 503 を返した。最後の版の試験用の文書の出力が、どれもその前に描いた文字列と同じ（新しい版の出力か、変えない元の文書）ことを確かめ、その描画を使った

### レビュー

- Antigravity CLI（`gemini-3.8-flash-high`。setup-notes の手順の使い捨てのフォルダーで 3 回。どれも SUCCESS で、拒まれた操作は無く、フォルダーは変わらなかった）と、
  Grok Build 1.0.52（読み取り専用。1 回目はフォルダーが変わらず全文を返した。2 回目は途中で使える量が尽きて止まった（402 Payment Required）ので、飛ばした）。指摘はどれも、ブラウザか実際の整形で確かめた
- 採った:
  - svg・math の中の CDATA（Grok・Antigravity）。CDATA があるときだけ、`]]>` までを 1 つにした読み方を足した（HTML の中の読み方を外すと、`<![CDATA[ > <pre> ]]>a   b</pre>` の pre を見落とすため、外さない）
  - 閉じタグの末尾の `/` で空要素にしていた（Grok・Antigravity）
  - 文書の書き方（Grok・Antigravity）。rules.md に、CommonMark の形でないタグの扱いと、変えないセルの例を足した（Antigravity の 3 回目）
- 調べて採った: svg の `xml:space="preserve"`（CDATA の指摘を確かめるうちに見つけた）、GitHub の `/` で区切った属性の読み方（属性の間に空白の無い表の整形を GitHub で描いて見つけた）
- 採らなかった:
  - 閉じない引用符のタグが文書の終わりまで続くと、リンク先の違う描画を同じ値にする・タグは出る（emit）、という指摘（Grok・Antigravity）: `X<a href="https://example.com/a   b` の body は `X` だけで、a 要素は無かった。
    仕様の Attribute value (double-quoted) state の EOF も、終わりの印だけを出す。描画は両方とも同じで、文字として比べるのは厳しい側
  - タグとして読む側で xmp・plaintext を空白を保つ要素から外す（Grok）: タグとして読む側は、noscript の中を HTML として読む場合も表す。外すと `<noscript><xmp>a   b</xmp></noscript>` と `a b` が同じ値に戻る（前の版の穴）。
    そのため、`<xmp><!--</xmp>-->  a  b` と `<xmp><!--</xmp>--> a b` は、前の版の「同じ値」から「別の値」になった（厳しい側）
  - `xml:space="default"` も数える（Antigravity）: 厳しい側。値は実体参照でも書ける
  - `</>`・引用符の中の CR・NUL・listing などをブロック要素に足すこと・`<img src="a.png" / >`（Grok・Antigravity）: どれも厳しい側か、前の版と同じ
  - CRLF の文書の複数行のコメントを拒む（Antigravity）: 前の版もこの版も CRLF のまま整形し、描画の比べも通った
  - CDATA の中のタグに似た文字で、対の候補作りが整形を見送る（Antigravity）: 拒む側で、描画の比べが守る
  - `htmlTagParts` の null の守り（Antigravity）: 呼び出し元はタグの片だけを渡す
  - 垂直タブ（U+000B）を CommonMark の形の空白に入れる（Antigravity の 3 回目）: WHATWG では垂直タブはタグの中の区切りでなく、入れなければ原文のまま比べる側（厳しい側）になるだけ

### 速さ

上の節と同じ測り方（Windows。`bench/bench.mjs`、中央値。小さい文書は 10 回、ほかは 5 回）。同じ PC でほかの作業も動いていたので、上の節より全体に遅い。前の版とこの版は交互に動かした。

| 文書 | 前の版 | この版 |
| --- | ---: | ---: |
| 1 行 | 393 ms | 361 ms |
| README 273 行 | 452 ms | 460 ms |
| `excel-check.md` 44 行 | 533 ms | 529 ms |
| 15,092 行 | 9,148 ms | 9,016 ms |
| `<div><p>…</p></div>` のブロックが 1,500 個並ぶ 2,999 行 | 1,099 ms | 1,141 ms |
| 属性の多いセルが 300 個ある 1 行の表（ふつうの書き方。出力は前の版と同じ） | 757 ms | 821 ms |
| 同じ表の属性を `title="t0"data-x=y` と `<a href="u0"/title=v>` にしたもの（どちらの版も変えない） | 588 ms | 630 ms |

- 増えた分は、タグごとに属性を読み、CommonMark の形かを確かめること

### この検証で未検証のこと・残る穴

- GitHub の HTML の読み方は、上の形のほかは調べていない。CommonMark の形のタグは WHATWG と同じに読むと見なしている
- svg・math の中の CDATA は、比べ方では 2 つの読み方で比べるが、対や字下げの候補作りは HTML の中の読み方だけで行う（整形を見送る側）
- `<style>` の規則や class で white-space を変える HTML は見分けない
- 上の節の残る穴のうち、script の escaped などの状態を HTML のブロックをまたいで持ち越さないことは、この版でも残る（文書全体の描画の比べで見分ける）
- Neovim の保存の整形そのもの
- abiko-pi での速さ
