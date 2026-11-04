# 素材族聚类：先折叠重复，再逐条核对

同一段素材被反复重编码上传，是这类账号最典型的特征：同一天同一分钟能发好几条，
时长只差 0.1 秒，标题换着写。逐条打开核对会把时间全花在"这是不是又是那段"上。

本目录的两个脚本把这一步提前做掉。

## 1. 列表阶段就把信号采集下来

`fingerprints.json`：

```json
{
  "schema_version": 1,
  "items": [
    {
      "video_id": "7693618238218865956",
      "url": "https://www.douyin.com/video/7693618238218865956",
      "creator": "某某专卖店",
      "duration_seconds": 54.1,
      "text": "原来这种藏在细节里的惦记 才是最戳人的浪漫 暖手宝",
      "hash": "e0e8e0f1c5696113"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `video_id` / `url` | 必填，规范 URL |
| `duration_seconds` | 强烈建议。列表页拿不到时，第一次打开视频时读 `video.duration` 补上 |
| `text` | 建议。标题原文，用来佐证同族 |
| `hash` | 可选但最有用。64 位帧/封面 dHash，16 位十六进制 |

**信号强弱决定能不能自动跳过**：只有时长重合、既没有哈希也没有标题佐证的族，
只会标成"可能同族（hint）"，仍然要实际打开一条核对，不会被静默跳过。

## 2. 哈希从哪来

截图已经拍了的话，用 `framehash.py`（需要 Pillow）直接转：

```sh
python3 scripts/framehash.py --out frames.json \
  --item 7693618238218865956=cover-1.png \
  --item 7698218865956000000=cover-2.png
```

或整目录模式（文件名里的数字串当 video_id）：

```sh
python3 scripts/framehash.py --out frames.json --dir ./covers
```

经验值：同一张图缩小一半再压成 JPEG q70，dHash 通常只差 1–2 位；不同素材基本差 20 位以上。
所以 `--hash-tol` 默认 8 是偏保守的，宁可多核一条。

## 3. 聚类

```sh
python3 scripts/families.py cluster \
  --fingerprints fingerprints.json \
  --library ~/Documents/抖音举报/素材族库 \
  --json-out clusters.json --md-out clusters.md
```

输出每族一个 `action`：

| action | 含义 | 要做什么 |
|---|---|---|
| `skip` | 命中已知排除族（时长+哈希/标题都印证） | 不用打开 |
| `inherit_candidate` | 命中已确认候选族 | 沿用结论，抽 1 条复核 |
| `review` | 新族，或只有时长提示 | 实际打开该族代表视频核对 |

判据说明：两条视频算同族需要 **时长差 ≤ `--duration-tol`（默认 0.6s）**，
且满足其一——帧哈希汉明距离 ≤ `--hash-tol`（默认 8），或标题 2-gram Jaccard ≥ `--text-tol`（默认 0.5）。
时长未知且没有标题的两个条目**不会**互相并族，避免把"没采到信号"堆成一个巨族。

## 4. 结论回写素材族库

核完一族，把结论沉淀下来，下一批直接受益：

```sh
# 排除族（不是我们的、或与本批原创无关）
python3 scripts/families.py learn --library ~/Documents/抖音举报/素材族库 \
  --fingerprints fingerprints.json \
  --members 7703460552076463401,7703460524108909843,... \
  --family-id elevator-double-warmth --verdict excluded \
  --label "电梯口 棕蓝外套 蓝格围巾 DOUBLE WARMTH" \
  --reason "无 UNEEDTOO，且与两条原创参考无对应镜头"

# 已确认候选族（下一次同族直接沿用）
python3 scripts/families.py learn ... --verdict candidate --family-id uneedtoo-roadside
```

`--verdict excluded` 写入 `known-negative.json`，`candidate` 写入 `family-fingerprints.json`。

## 5. 边界

- 聚类只解决"重复"，不解决"是不是侵权"。每族的结论仍要靠实际画面核对。
- `skip` 的前提是哈希或标题真的对上了；库里只有时长的族永远不会自动跳过。
- 素材被重新剪辑、加黑边、改比例后，dHash 可能拉开距离，这时会落到 `review`，属于预期行为。
- 素材族库是**本地私有数据**，不要提交进仓库或插件包。
