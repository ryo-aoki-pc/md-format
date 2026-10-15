# AGENTS.md

このリポジトリで作業するコーディングエージェント（Claude Code・Codex・Grok Build・Antigravity CLI）への指示。Claude Code は CLAUDE.md の `@AGENTS.md` で、Codex・Grok Build・Antigravity CLI はこのファイルを直接読む。

利用者への回答・質問・報告は、常に日本語で書く（コードのコメントなどの言語は、このファイルのほかの決まりに従う）。

GFM と GLFM の Markdown を、描画を変えずに整形する `mdfmt` コマンド。使い方は [README.md](README.md)、ルールごとの例は [docs/reference/rules.md](docs/reference/rules.md)、設計の理由は [docs/reference/readme.md](docs/reference/readme.md)、検証記録は [docs/verification/readme.md](docs/verification/readme.md)。Neovim の保存時の整形（conform と予備のプロセスの Lua）は [LazyVimStarter](https://github.com/ryo-aoki-pc/LazyVimStarter) にある。

## 導入手順の正本

Windows 11・AlmaLinux 10 の導入・利用・更新・任意操作は、setup-notes の [windows-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md) と [almalinux-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md) に集約する。既存の手順も対象とする。

- 固有の仕様・他 OS の手順・開発者検査・理由・注意・検証記録・ロールバックが残る文書は保持する
- 案内だけになった旧文書は削除する。README から上の2冊と[集約対応表](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/dev/consolidation-map.md)へ案内する

文書規則は、Windows・AlmaLinux の実行手順には上の正本へ適用する。操作や移動先を変えたら正本・README・集約対応表・参照情報を同期し、過去の検証本文は保持する。

## 構成

- `format.mjs` — 整形のライブラリ（`formatMarkdown`）と、`mdfmt` の入口。markdownlint-cli2 の修正候補を Comrak の構文木で確かめて当てる。loose のリストを詰める処理と、HTML のブロックの整形もここにある
- `cli.mjs` — コマンドライン（引数・標準入力・ファイル・フォルダ・`--write`・`--check`・終了コード）
- `spare.mjs` — Neovim の予備のプロセス。標準入力の依頼だけを受け、`cli.mjs` の `cli()` を走らせる
- `scripts/setup.mjs` — リポジトリの外への導入と `--check`
- `test/` — `node --test` の試験。`reference.test.mjs` は `docs/reference/rules.md` と README の「整形の例」の例をすべて整形し直して確かめる
- `docs/reference/rules.md` — 分類とルールごとの例（試験が読む。例の書き方は `reference.test.mjs` の決まりに従う）

## テスト

```sh
npm ci --ignore-scripts
npm test
for f in *.mjs scripts/*.mjs test/*.mjs; do node --check "$f"; done
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

## 共同作業の規則

このリポジトリでは、Claude Code・Codex・Grok Build・Antigravity CLI が同じ規則で作業する。分担と `main` への取り込みは人が決める。

- 起動された worktree（作業ディレクトリ）の中だけでファイルを変える。ほかの worktree のファイルは変えない
- 今のブランチにだけコミットする。`main` にはコミットも push もしない
- 頼まれた範囲のファイルだけを変える。範囲の外を変えるときは、変える前に理由を書いて確かめる
- 終わったら、テストとリンターを通してから、目的ごとにコミットする。通らなければコミットせずに、結果を報告する
- コミットしたら、今のブランチを push し、`main` への Pull Request を作る（既にあれば足す）。`main` への取り込み（マージ）とブランチの削除は人が行う。今のブランチに `main` を取り込むのは、頼まれたときと、Pull Request が競合したときだけ
- 秘密情報（`.env`・鍵・トークン・パスワード）を読まない・書かない・出力しない
- レビューを頼まれたら、ファイルを変えずに、指摘を「重大度・場所（ファイル:行）・理由・直し方」で挙げる
- ほかの担当の変更は、`git diff main...agent/codex` のように git で読む（ほかの worktree へ移らない）
