# AGENTS.md

このリポジトリで作業するコーディングエージェント（Claude Code・Codex・Grok Build・Antigravity CLI）への指示。Claude Code は CLAUDE.md の `@AGENTS.md` で、Codex・Grok Build・Antigravity CLI はこのファイルを直接読む。

GFM と GLFM の Markdown を、描画を変えずに整形する `mdfmt` コマンド。使い方は [README.md](README.md)、ルールごとの例は [docs/reference/rules.md](docs/reference/rules.md)、設計の理由は [docs/reference/readme.md](docs/reference/readme.md)、検証記録は `repos/md-format/docs/verification/readme.md`。Neovim の保存時の整形（conform と予備のプロセスの Lua）は [LazyVimStarter](https://github.com/ryo-aoki-pc/LazyVimStarter) にある。

## 導入手順の正本

Windows 11・AlmaLinux 10 の導入・更新・使い方の手順は、setup-notes の [almalinux-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md#md-format) と [windows-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md#md-format) の「md-format」とその子の項にある。このリポジトリには置かない。README の導入の概要と使い方、導入スクリプト（`scripts/setup.mjs`）、ルールの例・設計（`docs/`）は、このリポジトリに置く。導入や使い方の操作を変えたら、README と正本の手順を合わせる（正本は setup-notes の Pull Request で直す）。

## 構成

- `format.mjs` — 整形のライブラリ（`formatMarkdown`）と、`mdfmt` の入口。markdownlint-cli2 の修正候補を Comrak の構文木で確かめて当てる。loose のリストを詰める処理、HTML の表のセルの書き換え、HTML のブロックの整形もここにある
- `cli.mjs` — コマンドライン（引数・標準入力・ファイル・フォルダ・`--write`・`--check`・終了コード）
- `spare.mjs` — Neovim の予備のプロセス。標準入力の依頼だけを受け、`cli.mjs` の `cli()` を走らせる
- `scripts/setup.mjs` — リポジトリの外への導入と `--check`
- `test/` — `node --test` の試験。`reference.test.mjs` は `docs/reference/rules.md` と README の「整形の例」の例をすべて整形し直して確かめる
- `docs/reference/rules.md` — 分類とルールごとの例（試験が読む。例の書き方は `reference.test.mjs` の決まりに従う）
- `bench/bench.mjs` — 速さの測り方（比べるコマンドを交互に動かし、中央値と最も遅い値を Markdown の表で出す）
- 検証記録（試験・前の整形器との比べ・CLI・導入・速さ）は、Forgejo の非公開リポジトリ `setup-notes-verification` の `repos/md-format/docs/verification/` の `readme.md` に置く
- 検証記録を書く・直すときは、Forgejo の非公開リポジトリ `setup-notes-verification` を clone し、そちらへ Pull Request を作る。このリポジトリから検証記録へは URL で指さず、「`<検証記録のパス>` の「<見出し>」」と文字で書く（見出しを指さないときは、同じ名前の文書の記録なら「検証記録」とだけ書き、ほかの記録はパスを添える）

## テスト

```sh
npm ci --ignore-scripts
npm test
for f in *.mjs scripts/*.mjs test/*.mjs bench/*.mjs; do node --check "$f"; done
git diff --check
```

- Node.js 22 以上。依存は clone の `node_modules` に入る（`.gitignore` で除く）
- `GLFM_FORMAT_RUNTIME_DIR` を設定すると、試験はその `node_modules` を使う（導入先で確かめるとき）
- Neovim の保存時の整形は、LazyVimStarter の試験（conform と予備のプロセス）で確かめる。`format.mjs` の引数・予備の取り決め（`{script, argv, cwd}` と終了コード 86）を変えるときは、LazyVimStarter の Lua も合わせる

## 書き方の規則

- コードのコメントと利用者に出すメッセージは日本語。まわりのコードの書き方に合わせる
- 誤りは日本語 1 行で出す（`mdfmt: …`）。終了コードは 0（成功）・1（`--check` で変わるファイルがあった）・2（誤り）
- 整形の前後で描画を変えないことを崩さない。新しい修正は、構文木・GitLab や GitHub の記法・リストの tight を確かめてから当てる
- 描画に関わる変更は、Comrak の試験に加えて、GitHub（`gh api markdown`）や GitLab の Markdown API でも確かめ、検証記録に残す
- 分類やルールの例を足したら、`docs/reference/rules.md` に例を書く（試験が確かめる）
- ソースは LF。文書（README・docs）は日本語。検証していないことを「動く」と書かない。検証記録の過去の節は書き換えず、新しい節を足す
