# バズログ

X・YouTube・TikTok・Instagram でバズっている投稿や動画を、1つのページにまとめて表示するサイトです。

- **自動取得**: YouTube の急上昇（日本）を 3 時間ごとに自動で取り込みます
- **手動追加**: X / TikTok / Instagram（と YouTube）は、`data/manual.json` に URL を足すだけで載ります
- 表示は各サービス公式の埋め込みを使っています（画像や動画をコピーしていません）
- サーバー不要。GitHub Pages で無料公開できます

## なぜ X・TikTok・Instagram は手動なのか

この3つは「いまバズっている投稿」を取れる無料の公式APIがありません（X は有料プラン、TikTok・Instagram は審査制で用途も限定）。
非公式のスクレイピングは利用規約違反やアカウント停止のリスクがあるため、このサイトでは使っていません。
URL を貼れば公式埋め込みで表示されるので、運営者が「これは来てる」と思ったものを手で拾う形にしています。

## 公開までの手順（20分ほど）

1. **GitHub にリポジトリを作る**
   このフォルダの中身をそのまま push します（公開リポジトリなら Pages は無料）。

2. **YouTube の API キーを取る**（自動取得を使う場合）
   - [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
   - 「YouTube Data API v3」を有効化 → 「認証情報」から API キーを作成
   - 1日の無料枠（10,000 ユニット）に対し、このサイトの消費は 1 日 8 ユニット程度です

3. **キーを GitHub に登録**
   リポジトリの Settings → Secrets and variables → Actions → New repository secret
   名前 `YOUTUBE_API_KEY`、値に API キー

4. **GitHub Pages を有効にする**
   Settings → Pages → Source を「GitHub Actions」にする

5. **初回の実行**
   Actions タブ →「フィード更新と公開」→ Run workflow
   数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で見られます

## 投稿を手動で追加する

GitHub 上で `data/manual.json` を開き、鉛筆アイコンで編集して保存するだけです（保存すると自動で再公開されます）。

```json
{
  "items": [
    {
      "url": "https://x.com/ユーザー名/status/1234567890",
      "title": "見出し（省略可）",
      "note": "ひとことコメント（省略可）",
      "addedAt": "2026-11-11T12:00:00+09:00"
    }
  ]
}
```

対応している URL の形:

| 媒体 | 例 |
|---|---|
| X | `https://x.com/○○/status/123…`（twitter.com も可） |
| YouTube | `https://www.youtube.com/watch?v=…` / `/shorts/…` / `youtu.be/…` |
| TikTok | `https://www.tiktok.com/@○○/video/123…`（短縮URL `vt.tiktok.com` は開いた後の長いURLを貼る） |
| Instagram | `https://www.instagram.com/p/…` / `/reel/…` |

最初に入っている2件はサンプルなので、消して自分のものに差し替えてください。

## 設定を変える

`.github/workflows/update-feed.yml` で変更できます。

- 更新間隔: `cron: "17 */3 * * *"`（3時間ごと）
- 地域: `YOUTUBE_REGION: JP`（US, KR など）
- 件数: `YOUTUBE_MAX: 20`（最大 50）
- 手動投稿を自動で古い順に外したい場合は `MANUAL_MAX_DAYS: 14` のように追加

## 手元で確認する

```bash
YOUTUBE_API_KEY=xxxx node scripts/build-feed.mjs   # キーなしでも手動分だけで動きます
npx serve .                                          # http://localhost:3000 を開く
```

## 公開時の注意

- 埋め込みは各サービスの公式機能なので、投稿者が削除・非公開にすると表示されなくなります（その場合は「元の投稿を開く」リンクだけ残ります）
- 一般公開するので、個人が特定される投稿や炎上中の一般人の投稿は載せない方が安全です
- 広告収益化する場合は、各サービスの埋め込み規約を確認してください
