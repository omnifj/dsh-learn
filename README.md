# dsh-learn

面向 DeepSeek Harness 的 **1v1 AI 私教插件**：不是信息效率工具，而是"陪你学会"的私教。设计依据见 `dsh-learn插件开发计划书.md`。

## 教学闭环

```
摸底诊断 → 定制路线图 → 苏格拉底式讲解/追问 → 检查点考核
   ↑                                                ↓
间隔复习 ← 笔记沉淀 ← 掌握度评分（≥80 解锁下一节点）←┘
```

五大机制：先摸底再定制、苏格拉底式追问（禁直给答案）、四维掌握度 ≥80 才解锁、跨课程学习者画像、SM-2 间隔复习。

## 安装

在 DSH 中：**Plugins → Add plugin**，选择本目录（或 `plugin_manager` 的 `install_bundle`，target 为本目录绝对路径）。

安装后：

- 注册 14 个 `ai_learn_*` 工具（见下表）；
- 注册 `dsh-learn` 技能（SKILL.md 教学协议）。对 agent 说"我想学 React Hooks"即可开始一节课；
- 左侧边栏新增「学习分析」面板入口（[client.js](client.js)）：
  - **掌握进度折线图**：每个学习计划一条阶梯线，展示已掌握节点数随时间的累计变化，可按计划筛选高亮；
  - **路线图结构图（DAG）**：概念节点按依赖分层布局（布局计算在 [src/core/dag-layout.js](src/core/dag-layout.js)），颜色=状态，悬停显示四维分，点击节点高亮其依赖链；
  - **学习热力图**：最近 26 周的活动格子（摸底、评分、检查点作答、复习），按周一列对齐；
  - **教学质量指标**：每节点平均作答轮数（目标 ≥2）、复习通过率（目标 ≥70%）——让插件自己证明"能教"（计划书 §8）；
  - 顶部统计卡、每个计划的进度明细、多学习者筛选、**导出数据**按钮（下载单个 JSON 包）；
  - 每 60s 自动刷新 + 页面切回前台立即刷新；文案随界面语言（中/英）切换；
  - 数据来自 Host 侧 `/dsh-learn/api/analysis`（聚合逻辑在 [src/analysis.js](src/analysis.js)，可单测；跨工作区聚合所有已知存储根）。
- 会话内**教学卡片**（`tool.call.toolview`）：评分四维条形图卡、路线图节点卡、判分/错因卡、到期复习卡，替代原始 JSON 输出。
- **选项卡式交互**：诊断、探测、检查点中答案可枚举的问题通过 `ask_user_question` 选项卡一次批量提出（含"不知道"兜底项），不搞"问一题等一题"；教学流程与工具名等内部机制对学习者不透底。
- 插件详情页（Plugins → dsh-learn）内嵌**学习者画像编辑卡**：查看/修改背景、强项、讲解与节奏偏好，错因计数只读展示。
- **复习到期主动提醒**：Host 每 15 分钟检查复习队列，有到期项时唤醒最近的活跃 agent 提醒（24h 内最多一次；新会话创建时注入提醒上下文）。`reviewReminder: 'recent' | 'all' | 'off'` 可配。

## 快速开始（推荐用法）

1. **建一个固定的"学习"文件夹**（如 `D:\learn`），在 DSH 中作为工作区打开。
   - 学习数据（画像、路线图、笔记、复习队列）沉淀在 `<工作区>\dsh-learn\learn-default\`，都是 JSON/Markdown，可直接翻看；
   - **建议所有课程共用这一个文件夹**：画像是跨课程累积的，学过 Go 留下的强项/易错点会在学 Rust 时被私教用上；按主题各建一个文件夹会让画像互不通气；
   - 不建文件夹也能学——没有工作区时数据落在全局目录 `$DSH_HOME/dsh-learn`，但按项目隔离、笔记随手可查的体验会打折扣。
2. **新开一个会话**，输入框敲 `/` 会弹出技能补全，选 `/dsh-learn` 激活私教，然后直接说明来意，例如：
   ```
   /dsh-learn 我要学 Go 语言，目标是能独立写后端服务
   ```
   不敲斜杠、直接说"我想学 Go"也会触发（技能按意图自动匹配），但显式 `/dsh-learn` 最稳妥。
3. **有学习材料就丢进这个文件夹**（教程 PDF、文档、代码仓库），开场时提一句"参考材料在 ./docs 里"，私教会先读材料再摸底，讲解内容可溯源。
4. 之后跟着选项卡点选回答即可；学习进度随时在左侧边栏「学习分析」面板查看。

## 工具

| 工具 | 说明 |
|---|---|
| `ai_learn_diagnose` | 落盘交互式摸底结果（3–5 个诊断问题 + 各概念掌握估计 + 建议起点） |
| `ai_learn_create_roadmap` | 概念拆解为 DAG 并生成路线图；诊断达标节点自动跳过 |
| `ai_learn_update_roadmap` | `insertNode` 动态插入节点（防循环）/ `skipNode` 跳过 |
| `ai_learn_assess_mastery` | 四维评分（准确性/理解深度/举一反三/辨别能力），≥80 解锁下一节点，<60 重讲，60–79 追问；rationale 必须引用学习者原话 |
| `ai_learn_checkpoint` | 登记节点检查点题目（理解题 + 迁移题） |
| `ai_learn_submit_answer` | 判分并归类错因；同节点连续 2 次未通过 → remediate |
| `ai_learn_gen_notes` | 生成结构化笔记；必须含至少一条学习者本人表述 |
| `ai_learn_review_due` | 查询 SM-2 到期复习项 |
| `ai_learn_review_update` | 按 SM-2 更新调度；quality<3 节点降级 needs-relearn |
| `ai_learn_profile_get` / `ai_learn_profile_update` | 学习者画像读写（用户可查看、编辑、删除） |
| `ai_learn_learners` | 列出当前工作区所有学习者（learn-* 文件夹）及进度统计 |
| `ai_learn_export` | 导出一个学习者的全部数据为单个 `.dsh-learn.json` 包（画像 + 路线图 + 诊断 + 复习队列 + 笔记） |
| `ai_learn_import` | 把导出包恢复到当前工作区；可改名导入，覆盖需 `overwrite=true` |

所有工具接受可选 `learnerId`（默认 `default`），数据按学习者隔离。

## 配置（cordis.patch.yml 行内 config）

| 键 | 默认 | 说明 |
|---|---|---|
| `dataDir` | `$DSH_HOME/dsh-learn` | 兜底存储根目录（无法解析会话工作区时使用） |
| `masteryThreshold` | `80` | 解锁阈值 |
| `masteryWeights` | 四维等权 | `{ accuracy, depth, transfer, discrimination }` |
| `reviewReminder` | `'recent'` | 复习到期提醒目标：`'recent'`（最近活跃的 agent）/ `'all'` / `'off'` |

## Web API（面板与卡片使用）

| 端点 | 方法 | 说明 |
|---|---|---|
| `/dsh-learn/api/analysis` | GET | 跨存储根聚合：plans（含 DAG 布局与序列）、heatmap、quality、learners |
| `/dsh-learn/api/profile?learnerId=` | GET / POST | 画像读取 / 合并更新（GUI 写入总是落在兜底存储根） |
| `/dsh-learn/api/export?learnerId=` | GET | 下载该学习者的完整 JSON 导出包（`Content-Disposition: attachment`） |

## 存储布局

学习计划沉淀在**当前会话工作区**，一个学习者一个文件夹（`learn-xx`）：

```
<工作区>/dsh-learn/
├── learn-<learnerId>/
│   ├── profile.json              # LearnerProfile
│   ├── diagnoses/{id}.json       # 摸底结果
│   ├── roadmaps/{roadmapId}.json # 学习计划 + 节点状态 + 检查点记录
│   ├── notes/{roadmapId}/{nodeId}.md
│   └── review-queue.json         # SM-2 ReviewItem[]
└── exports/                      # ai_learn_export 的默认输出位置
```

无法解析会话工作区时回退到 `dataDir`（同样的布局）。旧版平铺在根目录的数据会在首次访问时自动迁移到 `learn-default/`。学习分析面板聚合全部学习者的数据。

## 与计划书的实现差异

计划书面向"理想工程"，本实现按 DSH bundle 的实际约束做了以下取舍：

1. **JavaScript（ESM）代替 TypeScript**：DSH bundle 无需构建工具即可加载；§4.1 的类型以 JSON Schema（工具参数）+ 运行时校验落实。
2. **node:test 代替 Vitest**：零依赖，`npm test` 即跑。
3. **仅 JSON 存储，未用 SQLite**：数据量小，JSON 已满足 §4.2 布局且便于用户查看/编辑/删除（数据主权）。
4. **prompts/ 位于 `src/skills/tutor/prompts/`**：技能的 `resourceBase` 只能指向一个目录，提示词随技能目录分发才能被按需加载。
5. **工具为"状态与纪律层"**：出题、评分判断、苏格拉底对话由 agent 按 SKILL.md 协议在会话中完成；工具负责持久化、解锁纪律、SM-2 与错因计数。
6. **按学习者分文件夹沉淀到工作区**：存储根从计划书 §4.2 的单一 `$DSH_HOME/dsh-learn` 演进为 `<工作区>/dsh-learn/learn-<learnerId>/`（旧布局自动迁移），并提供 `ai_learn_export` / `ai_learn_import` 备份迁移。

## 测试

```sh
npm test   # node --test tests/
```

50 个测试，覆盖：SM-2 附录 A 测试向量、概念图拓扑/循环/插入、状态机迁移、存储读写、学习者注册表（多根聚合/迁移/导出导入）、DAG 布局、分析聚合（含质量指标）、端到端教学闭环（摸底→路线图→检查点→评分解锁→笔记→复习降级）。
