# AGENTS.md

このリポジトリで作業するコーディングエージェント（Claude Code・Codex・Grok Build・Antigravity CLI）への指示。Claude Code は CLAUDE.md の `@AGENTS.md` で、Codex・Grok Build・Antigravity CLI はこのファイルを直接読む。

利用者への回答・質問・報告は、常に日本語で書く（コードのコメントなどの言語は、このファイルのほかの決まりに従う）。

GFM と GLFM の Markdown を、描画を変えずに整形する `mdfmt` コマンド。使い方は [README.md](README.md)、ルールごとの例は [docs/reference/rules.md](docs/reference/rules.md)、設計の理由は [docs/reference/readme.md](docs/reference/readme.md)、検証記録は [docs/verification/readme.md](docs/verification/readme.md)。Neovim の保存時の整形（conform と予備のプロセスの Lua）は [LazyVimStarter](https://github.com/ryo-aoki-pc/LazyVimStarter) にある。

## 導入手順の正本

Windows 11・AlmaLinux 10 の導入・更新・使い方の手順は、setup-notes の [almalinux-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md#md-format) と [windows-setup.md](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md#md-format) の「md-format」とその子の項にある。このリポジトリには置かない。README の導入の概要と使い方、導入スクリプト（`scripts/setup.mjs`）、ルールの例・設計・検証記録（`docs/`）は、このリポジトリに置く。導入や使い方の操作を変えたら、README と正本の手順を合わせる（正本は setup-notes の Pull Request で直す）。

## 構成

- `format.mjs` — 整形のライブラリ（`formatMarkdown`）と、`mdfmt` の入口。markdownlint-cli2 の修正候補を Comrak の構文木で確かめて当てる。loose のリストを詰める処理、HTML の表のセルの書き換え、HTML のブロックの整形もここにある
- `cli.mjs` — コマンドライン（引数・標準入力・ファイル・フォルダ・`--write`・`--check`・終了コード）
- `spare.mjs` — Neovim の予備のプロセス。標準入力の依頼だけを受け、`cli.mjs` の `cli()` を走らせる
- `scripts/setup.mjs` — リポジトリの外への導入と `--check`
- `test/` — `node --test` の試験。`reference.test.mjs` は `docs/reference/rules.md` と README の「整形の例」の例をすべて整形し直して確かめる
- `docs/reference/rules.md` — 分類とルールごとの例（試験が読む。例の書き方は `reference.test.mjs` の決まりに従う）
- `bench/bench.mjs` — 速さの測り方（比べるコマンドを交互に動かし、中央値と最も遅い値を Markdown の表で出す）
- `docs/verification/readme.md` — 検証記録（試験・前の整形器との比べ・CLI・導入・速さ）

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

## 共同作業の規則

このリポジトリでは、Claude Code・Codex・Grok Build・Antigravity CLI が同じ規則で作業する。分担は人が決める。

- 起動された worktree（作業ディレクトリ）の中だけでファイルを変える。ほかの worktree のファイルは変えない
- 今のブランチにだけコミットする。`main` にはコミットも push もしない
- 頼まれた範囲のファイルだけを変える。範囲の外を変えるときは、変える前に理由を書いて確かめる
- 終わったら、テストとリンターを通してから、目的ごとにコミットする。通らなければコミットせずに、結果を報告する
- コミットしたら、今のブランチを push し、`main` への Pull Request を作る（既にあれば足す）。今のブランチに `main` を取り込むのは、頼まれたときと、Pull Request が競合したときだけ
- `main` への取り込み（マージ）は、エージェントが行ってよい（2026-10-15、利用者の決定）。テストとリンターが通り、Pull Request が競合していなければ、`gh pr merge --squash` で Pull Request を取り込む（手元の `main` にはコミットも push もしない）。利用者が取り込まないよう頼んだときは取り込まず、そのことを報告する。取り込んだブランチには、その後コミットも push もせず、次の作業は新しいブランチで始める
  - リモートのブランチ: 取り込んだ Pull Request のブランチは、GitHub が自動で消す（リポジトリの Automatically delete head branches）。取り込む前に `gh api 'repos/{owner}/{repo}' --jq .delete_branch_on_merge` で確かめ、`false` なら `gh api -X PATCH 'repos/{owner}/{repo}' -F delete_branch_on_merge=true` で有効にする（`{owner}/{repo}` は gh が今のリポジトリで埋めるので、そのまま打つ）。取り込んだ後もリモートに残った自分のブランチは、`git push origin --delete <ブランチ>` で消す
  - 手元のブランチ: 自分が作ったブランチは、Pull Request が取り込まれたこと（`gh pr view <番号> --json state` が `MERGED`）と、どの worktree でも使っていないこと（`git worktree list`）を確かめてから、`git branch -D <ブランチ>` で消す（squash で取り込むので `git branch -d` は通らない）。今いるブランチは、新しいブランチへ移ってから消す。ほかの担当のブランチは消さない
  - Claude Code の worktree とブランチ: セッションの worktree は、Pull Request が閉じるとアプリがセッションをアーカイブして消す（Claude Code の設定の Auto-archive sessions when their pull request closes を有効にしておく。消えることはアプリの設定の説明による。コミットしていない変更がある worktree は残る）。残った `claude/` のブランチは、ほかの担当のブランチを消さない決まりの例外とする。Claude Code は、ほかのセッションが作ったものも、Pull Request が取り込まれたこと（`gh pr list --head <ブランチ> --state merged` に出る）と、どの worktree でも使っていないこと（`git worktree list`）を確かめてから、手元は `git branch -D <ブランチ>`、リモートに残っていれば `git push origin --delete <ブランチ>` で消す
- 秘密情報（`.env`・鍵・トークン・パスワード）を読まない・書かない・出力しない
- レビューを頼まれたら、ファイルを変えずに、指摘を「重大度・場所（ファイル:行）・理由・直し方」で挙げる
- ほかの担当の変更は、`git diff main...agent/codex` のように git で読む（ほかの worktree へ移らない）

## 既定の分担

利用者が Claude Code に、分担を指定せずにファイルを変える作業を頼んだときは、Claude Code が取りまとめて次の 4 つで分担する（2026-10-15、利用者の決定）。「共同作業の規則」の「分担は人が決める」で、人が分担を決めていないときの既定にする。利用者がほかのエージェントに直接頼んだときは、この節は使わず「共同作業の規則」に従う。

- Claude Code だけで行うもの: 利用者の質問への答え、ファイルを変えない調べもの、1 つのファイルの数行で振る舞いを変えない直し（誤字・リンク・値の直しなど）
- Claude Code: 計画・実機での確かめ・ほかの 3 つへの依頼・指摘の確かめ・統合・コミットと Pull Request・取り込み
- Codex: 実装と下書き。Claude Code が用意した別の clone か worktree の中だけで書く。この分担で頼まれたときは、「共同作業の規則」のコミット・push・Pull Request・取り込みを行わず、変更を残して報告する（Claude Code が確かめ、自分の worktree に移してからコミットする）
- Grok Build: 差分の読み取り専用のレビュー。ファイルを変えない（Windows 11 では、Claude Code は `--always-approve` を付けずに頼む）
- Antigravity CLI: 差分の読み取り専用のレビューと、その作業のための調べもの。ファイルを変えない（Claude Code は、入力を写した使い捨てのフォルダーで 1 回だけ実行し、`--dangerously-skip-permissions`・`--mode` を付けない）
- Claude Code から頼まれたエージェントは、上の自分の役割の範囲で作業する
- レビューの指摘は、実物で確かめてから採る。採らなかった指摘は、理由を付けて報告する
- 使えないエージェント（入っていない・ログインが切れた）は飛ばし、そのことを報告する
- 頼み方は、[setup-notes](https://github.com/ryo-aoki-pc/setup-notes) の `docs/ai-agents.md` の「コーディングエージェントの共同作業: Windows 11 で既定で分担する」と、`docs/reference/coding-agents.md` の「既定の分担」
