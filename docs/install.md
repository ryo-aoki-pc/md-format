# md-format の導入と更新（AlmaLinux 10・Windows 11）

- GFM と GLFM の Markdown を、描画を変えずに整形する `mdfmt` コマンド（[md-format](../README.md)）。Neovim（LazyVim）の保存のときの整形も、これを使う
- 使い方は [md-format の使い方](usage.md) にある
- どの項も単独で通せる。項のリードの前提を先に満たす
- bash のブロックはブラケットペーストの効く端末に、PowerShell のブロックは PowerShell 7 に貼り、貼った後に Enter を押す。貼り方と、反転表示の「確認」から後ろの出力の読み方は、setup-notes の [AlmaLinux 10 のセットアップ](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md) と [Windows 11 のセットアップ](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md) の冒頭に従う

<details id="この文書の補足と注意点">
  <summary>この文書の補足と注意点</summary>

**参照**

- 検証記録（setup-notes-verification の `docs/verification/almalinux-setup.md`）
- 検証記録（setup-notes-verification の `docs/verification/windows-setup.md`）

</details>

## AlmaLinux 10 で使う

- GNOME にログインした自分のユーザーで行う。前提の setup-notes の項は、各項のリードのリンクから開く

### md-format を導入・更新する

- md-format を `~/md-format` に clone し、リポジトリの外に依存を入れて、`mdfmt` コマンドを確かめる。更新も、この項の手順 2 で行う
- 前提: git が入っている（[Homebrew](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/almalinux-setup.md#homebrew)の手順 1 で入る）
- 実行場所: GNOME にログインした自分のユーザーの端末（bash）。`sudo` は、この項の手順 1 で Node.js が無いときだけ使う。更新では、`~/md-format` の手元の変更の確認を省かない

1. Node.js が無ければ dnf で入れ、版を確かめる。

   ```bash
   # Node.js と npm を導入する
   command -v node >/dev/null || sudo dnf install -y nodejs nodejs-npm
   printf '\n\033[7m 確認 \033[0m\n'
   node --version
   ```

   - `v22.` 以上の版が出ればよい
   - 22 より古い版が出たら、その Node.js を更新してから貼り直す

1. リポジトリを clone し、導入して確かめる。

   ```bash
   # md-format のソースを取得する
   git clone https://github.com/ryo-aoki-pc/md-format.git ~/md-format
   # コマンドを導入して設定を検査する
   (
     cd ~/md-format &&
       node scripts/setup.mjs &&
       node scripts/setup.mjs --check
   )
   ```

   - 最後に `導入済み: mdfmt` と版、起動コマンドのパスが出ればよい
   - `問題:` で始まる行が出たら、その案内に従って直してから `(`〜`)` を貼り直す（`~/.local/bin` が PATH に無いときは、PATH に加えてから端末を開き直す）
   - 更新時は `git -C ~/md-format pull --ff-only` し、この手順の `(`〜`)` の導入・確認を再実行する
   - `ほかの導入が動いています` で止まったら、表示のプロセスが終わるのを待って、`(`〜`)` を貼り直す
   - 古い整形器の依存が残っていると、`注意:` に `~/.local/share/nvim/glfm-format` が出る。LazyVim の設定を md-format を使う版に揃えた後なら、`rm -rf ~/.local/share/nvim/glfm-format` で消してよい

<details id="md-format-を導入更新する-の補足と注意点">
  <summary>md-format を導入・更新する の補足と注意点</summary>

**[md-format を導入・更新する](#md-format-を導入更新する)の手順 2**

- 依存はリポジトリ外の `~/.local/share/md-format` へ入る

- 起動コマンド `mdfmt` は `~/.local/bin`

- `--check` は何も変更せず状態を確かめる

</details>

---

## Windows 11 で使う

- この PC のデスクトップで、自分のユーザーが行う。前提の setup-notes の項は、各項のリードのリンクから開く

### Windows 11 で md-format を導入・更新する

- Markdown を整形する mdfmt を入れ、導入状態を確かめる
- 前提: [アプリを入れる](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md#アプリを入れる)の手順 2・3 を通し、同じ項の手順 9 で PowerShell 7 の実行ポリシーが `RemoteSigned`（`Unrestricted`・`Bypass` でもよい）であることを確かめてある
- 実行場所: この PC のデスクトップの管理者ではない PowerShell 7。この項の手順 1 で開く
- Node.js 22 以上が要る。この項の手順 2 で、無ければ scoop で入れる
- 更新時は `git -C "$env:USERPROFILE\md-format" status` で既存の変更を確かめてから進む

1. 管理者ではない PowerShell 7 を開く。

   - スタートメニューで「PowerShell」を探し、クリックして開く（「Windows PowerShell」ではない。「管理者として実行」にはしない）
   - 「PowerShell」が無ければ、[アプリを入れる](https://github.com/ryo-aoki-pc/setup-notes/blob/main/docs/windows-setup.md#アプリを入れる)の手順 6〜9 を通す

1. Node.js が無ければ scoop で入れ、版を確かめる。

   ```powershell
   # Node.js を導入する
   if (-not (Get-Command node -ErrorAction SilentlyContinue)) { scoop install nodejs-lts }
   "`n$([char]27)[7m 確認 $([char]27)[0m"
   node --version
   ```

   - `v22.` 以上の版が出ればよい
   - 22 より古い版やエラーが出たら、その Node.js を更新してから貼り直す

1. リポジトリを clone し、導入して確かめる。

   ```powershell
   # md-format のリポジトリを取得する
   git clone https://github.com/ryo-aoki-pc/md-format.git "$env:USERPROFILE\md-format"
   & {
     # mdfmt を導入する
     Push-Location -LiteralPath "$env:USERPROFILE\md-format" -ErrorAction Stop
     try {
       node scripts/setup.mjs
       "`n$([char]27)[7m 確認 $([char]27)[0m"
       node scripts/setup.mjs --check
     } finally {
       Pop-Location
     }
   }
   ```

   - 最後に `導入済み: mdfmt` と版、起動コマンドのパスが出ればよい
   - `問題:` で始まる行が出たら、その案内に従って直してから `& { ... }` 部分を貼り直す（`%USERPROFILE%\.local\bin` が PATH に無いときは、PATH に加えてから PowerShell 7 を開き直す）
   - 更新時は `git -C "$env:USERPROFILE\md-format" pull --ff-only` を実行し、この項の手順 3 の `& { ... }` 部分（導入・確認）を貼り直す。`git clone` は再実行しない
   - `導入先を入れ替えられません` で止まったら、Neovim をすべて閉じてから `& { ... }` 部分を貼り直す
   - 古い整形器の依存が残っていると、`注意:` に `%LOCALAPPDATA%\nvim-data\glfm-format` が出る。LazyVim の設定を md-format を使う版に揃えた後なら、そのフォルダーを消してよい

<details id="windows-11-で-md-format-を導入更新する-の補足と注意点">
  <summary>Windows 11 で md-format を導入・更新する の補足と注意点</summary>

**[Windows 11 で md-format を導入・更新する](#windows-11-で-md-format-を導入更新する)の手順 3**

- 依存はリポジトリ外の `%LOCALAPPDATA%\md-format` へ入る

- 起動コマンドは `%USERPROFILE%\.local\bin` の `mdfmt.ps1`（PowerShell）・`mdfmt.cmd`（cmd）・`mdfmt`（Git Bash）

- `--check` は何も変更せず状態を確かめる

- 終わると元の作業ディレクトリへ戻る

</details>

---
