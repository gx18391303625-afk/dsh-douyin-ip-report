# 固定资料映射

资料目录从私有 `config.json` 的 `materials` 字段读取，必须是本机绝对路径。目录内文件不随插件分发。

## 默认文件

| 项目 | patent | trademark |
|---|---|---|
| 页面类别 | 假冒专利 | 假冒商标 |
| 话术工作簿 | 侵权问题话术.xlsx | 侵权问题话术.xlsx |
| 话术定位 | 「专利侵权话术」正下方 | 「商标侵权话术」正下方 |
| 证明材料 | 专利投诉材料1.jpg 至 6.jpg | 商标投诉材料.png |
| 身份信息参考 | 专利侵权的组织身份.png | 商标侵权的组织身份.png |
| 营业执照 | patent-license.jpg | trademark-license.jpg |
| 链接工作簿表头 | 专利侵权链接 | 商标侵权链接 |

两个类型使用不同组织身份，运行时核对私有 `identity.json` 和对应证照；不能互换。

## materials.json（可选）

如果实际文件名与默认不同，在资料目录放一份 `materials.json`：

```json
{
  "patent": {
    "template_label": "专利侵权话术",
    "link_label": "专利侵权链接",
    "evidence": ["patent-evidence-1.jpg", "patent-evidence-2.jpg", "patent-evidence-3.jpg", "patent-evidence-4.jpg", "patent-evidence-5.jpg", "patent-evidence-6.jpg"],
    "identity_reference": "patent-identity.png",
    "license": "patent-license.jpg"
  },
  "trademark": {
    "template_label": "商标侵权话术",
    "link_label": "商标侵权链接",
    "evidence": ["trademark-evidence.png"],
    "identity_reference": "trademark-identity.png",
    "license": "trademark-license.jpg"
  }
}
```

- `evidence` 必须正好 6 个（专利）或 1 个（商标），只写文件名，不写目录。
- `template_label` / `link_label` 是工作簿里的文本，可按自己的模板修改。
- 文件只包含文件名，不含组织名或电话；仍建议保持私有，不要提交到 git。

## 预检限制

每批最多 1000 条链接，描述最多 500 个 UTF-16 字符，证明材料为 PNG/JPG/JPEG，单张不超过 5,000,000 字节；实际页面出现更严格限制时以页面为准。预检只检查文件、格式与完整性，不判断侵权事实。

本次链接由用户明确提供；不要把旧链接工作簿、历史任务、状态文件或当前举报列表随插件分发。
