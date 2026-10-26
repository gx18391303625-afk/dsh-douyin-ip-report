# 执行命令与回执查询

优先使用 [local-host.md](local-host.md) 中的 `host.py`。它读取本机私有配置，处理运行时、模块、专用 profile 与稳定任务路径。

## 运行时与身份

需要 Python 3.10+、Node.js 20+、Google Chrome。技能目录的 `scripts` 下运行 `npm install --omit=dev` 安装固定版本 `playwright-core`；再把 `node_path` 指向该 `node_modules`。

私有 `identity.json` 的结构为：

```json
{"patent":{"organization":"组织名称","phone":"联系电话","email":""},"trademark":{"organization":"另一组织名称","phone":"联系电话","email":""}}
```

使用对应身份截图核对真实值；空邮箱保持空白。不要把示例文字当作真实身份。身份文件和资料不随插件分发。

## 准备本次输入

以下底层命令在技能目录运行；将路径替换为本机实际绝对路径。

```sh
python3 scripts/prepare_job.py --materials '<资料目录>' --kind patent --check-only
python3 scripts/prepare_job.py --materials '<资料目录>' --kind trademark --links-file '<本次链接.txt>' --out '<私有目录>/job.json'
```

也支持 `--links-workbook` 读取用户明确指定的两列链接工作簿。两类分别生成任务。仅有空模板时不创建举报任务；输出不覆盖已有文件。

## 登录与执行

```sh
node scripts/runner.mjs --login --profile '<私有目录>/browser-profile' --channel chrome
node scripts/runner.mjs --job '<私有目录>/job.json' --identity-json '<私有目录>/identity.json' --profile '<私有目录>/browser-profile' --state '<私有目录>/job-state.json' --channel chrome
```

扫码完成后回到终端按 Enter。正常执行默认无头模式，不抢系统鼠标键盘；`--headed` 仅供用户接受可见窗口的调试。可用 `--executable-path` 指定实际 Chrome 路径，优先于 `--channel`。

第二条默认只填写并检查，随后关闭浏览器。用户明确要求举报或提交本批链接时，在相同命令添加 `--submit`。执行器记录点击与提交状态，空表单不算明确成功。结果未核验时查询历史，不自动重试；明确失败的同一任务可按授权追加 `--retry-failed --submit`。

## 查询回执与原举报

```sh
node scripts/runner.mjs --history --profile '<私有目录>/browser-profile' --channel chrome
node scripts/runner.mjs --receipt '<实际批次编号>' --video-ids '<视频ID.txt>' --profile '<私有目录>/browser-profile' --channel chrome
```

或通过 `host.py status` 使用同样参数。`视频ID.txt` 每行一个纯数字视频 ID。指定 `--receipt` 时只查询该批次；省略它并提供 `--video-ids` 时，扫描历史批次以查找原记录。查询不点击提交，不撤销举报。

历史和回执有分页，共享读取上限 `--max-pages`，默认 100、最大 200。输出 `complete: false` 或 `history_partial` 时说明扫描不完整；不能将未找到的目标推断为已通过或不存在。`targets[].original_status` 只有在读取到原记录的直接证据且状态一致时才给出，否则为 `unknown`；用 `records` 核对依据。

遇到「24 小时内已举报过」时，当前批次只证明本次重复提交失败。用相同视频 ID 在原批次中查询，才可报告原举报状态。输出中有查询时间；“审核中”只对应查询当时。批次“已完成”也不能替代每个视频的处理结果。

## 自测与验证边界

```sh
node scripts/runner.mjs --self-test --channel chrome
```

自测在本地合成页面执行，不请求抖音。它检查页面交互和停止条件，不证明目标电脑已登录或平台已接收举报。真实页面已验证的流程见 [workflow.md](workflow.md)；平台改版后需要按实际页面重新校准。
