# 三个 Skill 的开源评估与使用说明

本文适用于 `tools/skill` 下的三个 Skill：

- `funny-animation-assistant`
- `novel-to-shadiao-script`
- `shadiao-script-to-anime`

评估日期：2026-08-05。

## 结论摘要

三个 Skill 都具备开源基础，但不建议在没有补充发布说明的情况下直接宣称为“开箱即用的稳定版”。更合适的首发定位是 **MIT 许可的预览版或 Beta 版**。

| Skill | 当前建议 | 主要理由 |
| --- | --- | --- |
| `funny-animation-assistant` | 有条件开源 | 结构、许可证和本地 Bridge 安全测试正常，但实际能力依赖 Adobe Animate 插件及双方协议版本；Skill 本身不能独立完成端到端工作。 |
| `novel-to-shadiao-script` | 修正安装脚本后适合开源 | 内容型 Skill 可移植性较好，也包含版权边界和多工具适配器；但安装脚本会强制覆盖目标文件，应先增加备份、冲突检测或明确确认。 |
| `shadiao-script-to-anime` | 有条件开源 | 生成与验证逻辑较完整，但与“沙雕动画小助手”的 `.anime` 私有数据结构、动作 schema、素材库和语音目录强耦合；应补充 schema 版本和语音目录来源/授权说明。 |

建议完成本文“发布前必须处理”部分后再公开发布。

## 已完成的检查

- 三个目录都包含 MIT `LICENSE`。
- 三个 `SKILL.md` 均通过 Codex `skill-creator` 的 `quick_validate.py` 结构校验。
- Skill 名称均符合小写字母和连字符命名规则。
- 三个 Skill 都包含 `agents/openai.yaml`，界面元数据完整。
- 所有 JavaScript/MJS 文件通过 `node --check`。
- 所有 JSON 文件均可正常解析。
- `funny-animation-assistant/bridge` 的 3 个测试全部通过：Token 鉴权、异常 Host 处理、WebSocket 错误 Token 拒绝。
- 未发现真实 API Key、密码、私钥、Bearer Token、个人账号或用户绝对路径。
- Bridge 只监听 `127.0.0.1`，并支持 `FAA_BRIDGE_TOKEN`。

以上是静态检查和局部自动化测试结果，不等同于在 Adobe Animate 或真实 `.anime` 项目中的完整端到端验收。

## 发布前必须处理

### 1. 明确代码、素材和目录数据的权利来源

MIT 文件只能表达发布者的许可意图，不能自动证明发布者拥有全部内容的再许可权。发布前应确认：

- 所有脚本、模板、参考文档和示例文字均为原创或有权以 MIT 发布。
- `shadiao-script-to-anime/references/voice-options.json` 中的语音 ID、名称、描述和厂商字段允许公开分发。
- Adobe、Animate、抖音、快手、B站、腾讯等名称仅用于兼容性说明，不暗示官方授权或背书。
- 若 `.anime` schema 或插件通信协议来自非公开产品代码，应确认允许公开文档化和复用。

建议在仓库根文档增加商标声明和第三方数据来源说明。若语音目录不能确认授权，应改为由用户从本地项目导出，或仅保留最小示例 schema。

### 2. 修复适配器安装脚本的覆盖行为

`novel-to-shadiao-script/scripts/install_adapters.ps1` 当前使用 `Copy-Item -Force`，可能覆盖已有的：

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/instructions/novel-to-shadiao-script.instructions.md`
- `.claude/skills/novel-to-shadiao-script`
- 用户目录中的 Codex Skill

公开发布前建议至少实现一种保护：目标存在时停止并提示、先生成备份、提供 `-Force` 显式开关，或执行可合并安装。修复前，使用者应先备份这些目标，且不要在有自定义规则的仓库中直接运行 `-AllProject`。

### 3. 声明运行时和产品依赖

建议在发布页明确列出：

- Node.js 18 或更高版本。
- `funny-animation-assistant` 需要 Adobe Animate、配套插件面板和兼容的 Bridge 协议版本。
- `novel-to-shadiao-script` 的校验器需要 Python 3。
- `shadiao-script-to-anime` 需要现有 `.anime` 项目、兼容 schema，以及项目内已有的人物、场景、背景和动作资源。
- 三个 Skill 都不是独立桌面应用；它们主要供 Codex、Claude Code 或其他支持指令/Skill 的 AI 工具调用。

### 4. 补充版本兼容性

建议为插件协议和 `.anime` 数据结构增加明确版本字段或兼容矩阵，例如：

| 组件 | 应声明的版本 |
| --- | --- |
| Skill 发布版本 | Git tag 或语义化版本 |
| Animate 插件 | 最低/最高兼容版本 |
| Bridge 协议 | `protocolVersion` |
| `.anime` schema | schema 版本或应用版本 |
| 语音目录 | 来源版本和更新时间 |

缺少这些信息时，用户遇到 schema 漂移或协议不匹配将难以定位原因。

### 5. 增加端到端测试和示例

当前 Bridge 有局部测试，但另外两个 Skill 缺少可直接运行的回归样例。建议增加不含版权风险的最小测试夹具：

- 一小段原创小说与期望的剧本结构。
- 一个脱敏、最小化的 `.anime` 文件。
- 一份生产剧本 Markdown 和预期验证结果。
- 一个模拟插件响应的 Bridge 集成测试，避免 CI 依赖 Adobe Animate。

## 安装方式

### 方式一：安装到 Codex 用户 Skill 目录

在 PowerShell 中执行：

```powershell
$source = "<仓库路径>\tools\skill"
$target = Join-Path $env:USERPROFILE ".codex\skills"

Copy-Item -Recurse "$source\funny-animation-assistant" "$target\funny-animation-assistant"
Copy-Item -Recurse "$source\novel-to-shadiao-script" "$target\novel-to-shadiao-script"
Copy-Item -Recurse "$source\shadiao-script-to-anime" "$target\shadiao-script-to-anime"
```

若目标目录已存在，请先比较内容并备份，不要直接覆盖。复制完成后重启或刷新 Codex，使其重新发现 Skill。

### 方式二：仅在当前仓库使用

保留现有目录结构，并在请求中明确指定 Skill 路径，例如：

```text
使用 tools/skill/novel-to-shadiao-script/SKILL.md，把这篇我原创的小说改成 3 集沙雕动画剧本。
```

这种方式不会写入用户级 Skill 目录，适合开发和测试。

### 方式三：安装小说改编 Skill 的多工具适配器

先提交或备份仓库中的 `AGENTS.md`、`.github` 和 `.claude` 相关文件，再执行：

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\tools\skill\novel-to-shadiao-script\scripts\install_adapters.ps1 `
  -RepoRoot . `
  -AllProject
```

如需同时安装到当前 Windows 用户的 Codex Skill 目录，可追加：

```powershell
-InstallCodexUser
```

注意：当前脚本会强制覆盖同名目标；在完成前述安全修复前，不建议对含自定义 AI 指令的仓库直接执行。

## 使用方法

## 1. funny-animation-assistant

### 适用场景

- 检查 FLA 舞台、时间轴、帧、元件或组结构。
- 切换帧、批量扫描 FLA。
- 导出人物、场景模板、道具、表情或背景的 PNG/config 资源。
- 查询、等待或取消插件任务。

该 Skill 的设计边界是读取、导航和导出，不应保存、重命名、删除或直接修改 FLA 内容。

### 前置条件

1. 安装 Node.js 18+。
2. 打开 Adobe Animate 和目标 FLA。
3. 打开“沙雕动画小助手”插件面板。
4. 进入 `AI自动化`，启用 `允许外部工具控制`。
5. 在多人共用电脑或高安全环境中配置随机 Token：

```powershell
$env:FAA_BRIDGE_TOKEN = "<随机高强度字符串>"
```

不要把真实 Token 写入仓库、命令示例或截图。Bridge 支持 URL 查询参数 Token，但公开使用时应优先使用请求头/环境变量，避免 Token 被日志记录。

### 快速检查

```powershell
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js doctor
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js status
```

若 `plugin.online` 为 `false`，检查 Animate、插件面板和外部控制开关。若报告协议版本不匹配，应停止操作并升级对应组件。

### 常用命令

```powershell
# 扫描当前帧
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js scan

# 查看时间轴
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js timeline

# 扫描第 18 帧
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js scan-frame --frame 18

# 导出指定舞台根元素
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js export-stage-one `
  --layerIndex 0 --elementIndex 0 --frame 18 --level 2 `
  --out D:\exports\characters --timeout 600

# 查看当前任务
node .\tools\skill\funny-animation-assistant\scripts\faa-cli.js job
```

导出前应明确素材类型、目标帧、舞台根元素和导出层级。人物一般先尝试 Level 2；只有 Level 2 仍是容器且 Level 3 不会拆出碎片时才使用 Level 3。

### Bridge 自测

```powershell
Set-Location .\tools\skill\funny-animation-assistant\bridge
npm test
```

Bridge 无第三方 npm 运行依赖，Node.js 18+ 即可运行测试。

## 2. novel-to-shadiao-script

### 适用场景

- 把用户原创、已获授权或公版小说改编为沙雕动画短视频剧本。
- 输出单集、多集、分幕或分镜结构。
- 生成以旁白/对白为主的可制作脚本。

对于未获授权的受保护作品，不应进行贴近原作的复刻；可改为摘要、评论，或仅保留宽泛类型元素创作全新故事。

### 推荐提示词

```text
使用 novel-to-shadiao-script。以下内容由我原创，请改编成 3 集中文沙雕动画剧本，每集 1–2 分钟。默认采用“序号 | 旁白/对白 | 音效/BGM”表格；按地点变化分幕；每集结尾保留钩子。把结果保存为 UTF-8 Markdown。
```

如需要分镜列，请明确要求：

```text
额外输出画面配合和镜头建议，使用 storyboard-table 模板。
```

### 校验生成的剧本

```powershell
python .\tools\skill\novel-to-shadiao-script\scripts\validate_script.py `
  .\output\episode-script.md
```

校验失败时，应根据报告补齐剧名、集标题、分幕、角色表、台词表或结尾钩子，而不是忽略错误。

### 可选模板

- `templates/episode-script.md`：单集剧本。
- `templates/batch-episodes.md`：多集规划。
- `templates/storyboard-table.md`：分镜表。
- `templates/structured-script.json`：下游自动化结构。

## 3. shadiao-script-to-anime

### 适用场景

- 把已完成的生产剧本表转换为 `.anime` 项目中的剧集、场景和台词块。
- 绑定现有人物、场景模板、背景和配音。
- 默认生成轻量 `camera_follow` 与 `set_anim` 动作。
- 验证空场景、无效人物、动作目标、语音冲突和素材缺失。

它不负责把小说改写为剧本。完整流水线应先使用 `novel-to-shadiao-script`，确认剧本后再使用本 Skill。

### 推荐提示词

```text
使用 shadiao-script-to-anime，把 scripts/第1集.md 导入 projects/demo.anime。先备份原文件，只使用项目现有的人物、场景模板和背景；保留现有配音；默认仅生成 camera_follow 和 set_anim。完成后运行 refined 校验并报告备份路径、场景数、台词块数、动作覆盖率和警告。
```

如只需静态导入，必须明确说明：

```text
只导入场景和台词，不生成动作；使用 static 校验配置。
```

### 验证 `.anime` 项目

默认精修配置：

```powershell
node .\tools\skill\shadiao-script-to-anime\scripts\validate_script_to_anime.mjs `
  --anime=.\projects\demo.anime
```

严格限制默认动作和环境光：

```powershell
node .\tools\skill\shadiao-script-to-anime\scripts\validate_script_to_anime.mjs `
  --anime=.\projects\demo.anime `
  --allowed-actions=camera_follow,set_anim `
  --require-light-intensity=1
```

仅在用户明确要求静态导入时使用：

```powershell
node .\tools\skill\shadiao-script-to-anime\scripts\validate_script_to_anime.mjs `
  --anime=.\projects\demo.anime `
  --profile=static
```

`scripts/build_anime_core.mjs` 是供项目构建脚本导入的库，不是完整的通用 CLI。实际生成器应放在用户项目中，先备份 `.anime`，再导入该模块并按目标项目 schema 组织数据。不要把未验证的 `.anime` schema 当作跨版本稳定接口。

## 推荐的两阶段工作流

1. 使用 `novel-to-shadiao-script` 生成并人工确认剧本。
2. 运行 `validate_script.py` 修复剧本结构问题。
3. 使用 `shadiao-script-to-anime` 读取剧本和目标 `.anime` 项目。
4. 在写入前创建 `.anime` 备份。
5. 只复用项目已有素材，生成场景、台词块及默认轻量动作。
6. 运行 `validate_script_to_anime.mjs`。
7. 在沙雕动画小助手中打开项目，人工检查构图、人物绑定、动作和配音。
8. 如果需要从 FLA 补充人物或场景素材，再单独使用 `funny-animation-assistant` 导出，并重新导入项目。

## 开源发布建议清单

发布前逐项确认：

- [ ] 确认所有源代码、模板、参考资料和语音目录可按 MIT 再分发。
- [ ] 修复 `install_adapters.ps1` 的默认覆盖行为。
- [ ] 写明商标归属以及“非 Adobe/平台官方项目”。
- [ ] 写明 Node.js、Python、Adobe Animate、插件和 `.anime` schema 的兼容版本。
- [ ] 为两个转换 Skill 增加原创、脱敏的测试夹具和回归测试。
- [ ] 为 Bridge 增加模拟插件的协议集成测试。
- [ ] 确认发行包不包含真实小说、商业素材、FLA、`.anime` 项目、日志、Token 或用户路径。
- [ ] 在 CI 中运行 JS 语法检查、JSON 解析、Skill 结构校验和现有 Bridge 测试。
- [ ] 使用 Git tag 固化首次公开版本，并在变更协议/schema 时升级版本号。

完成上述事项后，这三个 Skill 适合作为一个相互衔接的开源工具组发布；在完成前，建议标记为 Preview/Beta，并清楚声明外部依赖和兼容范围。
