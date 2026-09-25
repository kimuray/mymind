# 運用の手順

手元で mymind を使い続けるための手順です。更新とバックアップからの復元をまとめます（NFR-04、issue 024）。

## データの場所

実データは `~/.mymind/`（`MYMIND_DATA_DIR` で変更できる）にあります。

| パス | 内容 |
|---|---|
| `mymind.db`（と `-wal`、`-shm`） | DB。本人だけが読める（600） |
| `backups/pre-migration-<時刻>.db` | マイグレーションの前に自動で取ったスナップショット |
| `backups/before-restore-<時刻>.db` | 復元の直前に残した、入れ替える前の DB |
| `mymind.lock` | 起動中のサーバーの PID。同じデータディレクトリで2つ起動しないためのロック |

時刻は UTC で、`20260925T075324Z` の形です。

## 新しいバージョンにする

```sh
pnpm update-app
```

`main` にいてコミットしていない変更がないことを確かめてから、`git pull --ff-only`、`pnpm install --frozen-lockfile`、`pnpm build` を順に実行します。終わったらサーバーを再起動してください（常駐させる設定は issue 003 で用意します）。

再起動のとき、まだ適用していないマイグレーションがあれば、サーバーは**適用の前に** `backups/pre-migration-<時刻>.db` へスナップショットを取り、次のように表示します。

```
マイグレーション（20260924132619_agent_jobs）の前にバックアップしました: ~/.mymind/backups/pre-migration-20260925T075324Z.db
```

新しく作る DB と、すべて適用済みの DB では取りません。

## バックアップから戻す

マイグレーションに失敗したときや、データを誤って壊したときに使います。

1. サーバーを止める（動いているあいだは、戻すコマンドが拒否します）
2. 戻したいファイルを選ぶ

   ```sh
   ls -l ~/.mymind/backups/
   ```

3. 戻す

   ```sh
   pnpm restore-backup ~/.mymind/backups/pre-migration-20260925T075324Z.db
   ```

   コマンドは次の順に処理します。

   - バックアップが壊れていないこと（`PRAGMA integrity_check`）と、mymind の DB であること（マイグレーションの記録があること）を確かめる。だめなら今の DB に触れずに終わる
   - サーバーと同じロックを取る。サーバーが動いていれば終わる
   - 今の DB を `backups/before-restore-<時刻>.db` に残す
   - 古い `-wal` と `-shm` を消し、バックアップを `mymind.db` に写す（600）

4. 古いバージョンのコードで使う場合は、`git checkout` でマイグレーションを失敗する前のコミットに戻す。新しいバージョンのまま起動すると、足りないマイグレーションがもう一度適用される（その前に改めてスナップショットを取る）
5. サーバーを起動し、画面でデータを確かめる

戻したあとで「やはり戻す前がよかった」ときは、同じ手順で `before-restore-<時刻>.db` を指定します。

## 復元を試す

復元できることは、`apps/server/src/backups.test.ts` で、実際の SQLite のファイルを使って確かめています（入れ替え、戻す前の DB の保存、サーバーが動いているときの拒否、壊れたファイルの拒否）。

手元の環境で試すときは、実データに触れないように、別のデータディレクトリを使います。

```sh
# start はパッケージのディレクトリで動くので、データディレクトリは絶対パスで渡す
export MYMIND_DATA_DIR="$PWD/.data/restore-trial" MYMIND_PORT=4831
pnpm --filter @mymind/server start   # 画面でタスクを1つ追加して止める
pnpm restore-backup <戻したいファイル>
pnpm --filter @mymind/server start   # 戻っていることを確かめる
```
