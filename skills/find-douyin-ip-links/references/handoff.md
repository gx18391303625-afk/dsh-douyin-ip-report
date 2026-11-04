# 交接给抖音举报插件

按本批范围生成 UTF-8 文件。将参考素材保留在用户的私有工作目录，技能和插件包只保存通用指令。使用实际观察值，示例里的占位内容必须替换后才能交接。

## 结构化结果

保存 `discovery.json`，至少包括下列结构。`coverage` 按达人分别记录，`records` 保留候选、待核对、排除和不可见条目。

```json
{
  "schema_version": 1,
  "source": "creator_discovery",
  "scope": {
    "creators": ["本批达人名称"],
    "kinds": ["trademark", "original"],
    "date_start": "页面实际起日",
    "date_end": "页面实际止日",
    "category": "本批页面实际类目",
    "reference_inputs": ["用户本批参考素材的私有路径或文件标识"]
  },
  "coverage": [
    {
      "creator_input": "本批达人名称",
      "pages_checked": 0,
      "videos_checked": 0,
      "complete": false,
      "platform_limit": null,
      "stop_reason": "尚未执行",
      "resume_position": null
    }
  ],
  "records": [
    {
      "creator_input": "本批达人名称",
      "creator_observed": "页面名称",
      "video_url": "https://www.douyin.com/video/目标数字ID",
      "video_id": "目标数字ID",
      "kind": "original",
      "review_state": "needs_review",
      "product_match": null,
      "trademark_observation": null,
      "original_url": "https://www.douyin.com/video/原创数字ID",
      "association_basis": "用户明确指定或本批画面对比匹配",
      "target_published_at": null,
      "original_published_at": null,
      "evidence": [
        {
          "target_time": null,
          "original_time": null,
          "observation": "实际观察到的画面及对应关系"
        }
      ],
      "uncertainty": "待核对的具体原因",
      "checked_at": "带时区的实际核对时间"
    }
  ]
}
```

未知值使用 `null`。商标记录的 `original_url` 为空。每条原创候选必须能明确关联一个当前参考原创，存在多个可能来源时保留 `needs_review`。以视频 ID 去重，多个类型的命中可分别记录，执行范围依据本批要求确定。

## 执行输入

从本批明确选入执行范围的 `candidate` 条目导出。分别保留待核对清单，避免把待核对记录自动当成执行目标。

| 文件 | 内容 |
|---|---|
| `trademark-targets.txt` | 本批商标目标，每行一个规范化视频 URL |
| `original-targets.txt` | 本批原创目标，每行一个规范化视频 URL |
| `originals.json` | 本批原创目标 URL 到对应原创 URL 的映射 |

仅生成有对应条目的文件。原创映射必须完整且仅覆盖 `original-targets.txt`，目标与原创 ID 必须不同。多个目标共用一个原创时仍保留逐条映射，方便审计及后续接入。

```json
{
  "https://www.douyin.com/video/目标数字ID": "https://www.douyin.com/video/对应原创数字ID"
}
```

在交接前核对 URL 格式、唯一目标数、类型、映射覆盖、候选范围与匹配依据。使用当前版 `douyin-ip-report` 的 `prepare --kind trademark --links-file ...`，或 `prepare --kind original --links-file ... --originals-file ...` 参数。把这里的命令视为输入约定，实际执行先读取当前执行技能并检查它的前提条件。

## v0.7.1 接入点

现有仓库为 `gx18391303625-afk/dsh-douyin-ip-report`，执行技能位于 `skills/douyin-ip-report`。此版本要求目标由用户本次明确提供，原创来源必须有明确的本批关联。新增的达人发现结果需要在后续整合时加入接收约定，不能通过伪称“用户粘贴了全部链接”来绕过。

明确记录本批用户指定的达人、筛选类型、发现范围与原创参考，向用户展示本批发现清单及关联。当前执行技能若要求确认，应按该要求完成本批确认，再调用既有准备与执行逻辑。沿用提交确认开关，保持任务状态与结果不明时的处理规则。

将包含本技能的目录交给宿主时，按宿主自己的技能注册机制配置。现有 DSH 插件通过 `cordis.patch.yml` 注册技能目录，单纯加入源码目录不代表已注册或安装。后续整合需检查宿主浏览器视觉能力、技能注册和发现结果交接，并用用户指定样本验证完整流程。
