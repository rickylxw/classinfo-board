# 仓库管理设计（REPO MANAGEMENT）

> 本文档定义「课程信息板」代码仓库的入库边界、分支与提交规范、GitHub 管理流程。
> 2026-10-15 由仓库管理负责人制定；与 [SECURITY.md](../SECURITY.md)（安全运维）配套阅读。

## 1. 原则

1. **仓库只存代码与文档，永不存数据。** 运行时数据（含明文 ehall Cookie、学号、共享板内容）只存在于 `backend/data/`，其耐久性由后端的原子写入 + 滚动备份体系保证（见 SECURITY.md），git 不参与、不兜底。
2. **秘密零入库。** 管理员密码、Cookie、token 一律走环境变量或运行时输入；哪怕仓库是私有的也不例外——私有仓库成员多于一人，且历史难撤销。
3. **提交即可回溯的检查点。** 本项目由多个并行会话（Trae/ZCode）+ 人工共同改动，频繁小步提交是并行冲突的唯一解药；`backend/server.mjs` 等热点文件改动前必须先 `git pull` / 看最新提交。

## 2. 入库边界

**入库（白名单）**：`src/`、`backend/*.mjs`（server 与测试/恢复脚本）、根 `server.mjs`、`index.html`、`vite.config.js`、`package.json` + `package-lock.json`、`README.md`、`SECURITY.md`、`docs/`。

**不入库（.gitignore 黑名单）**：

| 路径 | 原因 |
|---|---|
| `backend/data/` | 运行时数据：明文 ehall Cookie、学号、共享板内容、sessions、滚动备份 |
| `backend/manual-backups/` | 事故快照，含真实用户数据 |
| `backend/.tmp-sync-test/` | 同步测试的隔离 DATA_DIR 与日志 |
| `node_modules/` `dist/` | 依赖与构建产物，可重建 |
| `*.log` `.env*` | 日志与环境变量（可能含密码/令牌） |
| `.zcode/` | AI 会话计划等本地工具产物 |

**红线（提交前必查）**：
- 管理员密码 / ehall Cookie / session token / 学号名单，任何形式（含注释、示例、测试夹具）都不得出现在暂存区。测试脚本一律 `process.env.ADMIN_PASS` 等方式取值（2026-10-15 已清理三处硬编码）。
- 提交前跑一次 `git diff --staged` 目视扫描，重点看新增的 `.md`、测试脚本与文档。

## 3. 分支模型

单人 + 并行 AI 会话的小团队场景，采用**主干为主的最简模型**：

- `main`：唯一权威分支，保持可运行（`npm run dev` 双进程能起）。远端 GitHub 上的 `main` 为生产参照。
- 直接在 `main` 上做小改动（文档、样式、小修复）。
- 有风险/多文件的改动开短命分支 `feat/<主题>` 或 `fix/<主题>`，完成后合回 `main` 并删分支。分支存活不超过数天。
- 不设 develop/release 等长期分支——部署目标就是本机一台主机，`main` 即发布源。

## 4. 提交规范

- 格式：`<type>: <一句话中文说明>`，type 取 `feat` / `fix` / `chore` / `docs` / `refactor` / `test`。
- 一次提交一件事；并行会话各自提交各自的改动，禁止「顺手」把别人的半成品一起提交。
- 数据事故恢复、安全加固这类关键节点，提交说明里写清背景（后续翻历史时能看懂为什么）。

## 5. 版本与标签

- `package.json` 的 `version` 语义化递增：数据格式/同步协议变更升 minor，界面大改升 minor，修复升 patch。
- 每次大版本打标签：`git tag v2.1 && git push --tags`。标签是「数据事故时能退回的最后一个已知好版本」的锚点。

## 6. GitHub 仓库管理

- **可见性：私有起步，内容随时可公开**（2026-10-15 与负责人确认）。全体历史从首个提交起就按「可公开」标准消毒：真实学号、ehall Cookie、管理员密码、内网具体 IP、本机盘符路径一律不入库，日常提交按 §2 红线自检。这样未来转公开（`gh repo edit --visibility public`）无需重写历史。
- 远端唯一：`origin` = GitHub 仓库；本机 `main` 与远端 `main` 保持一致，推送前先拉取。
- `gh` CLI 操作（登录后）：
  ```bash
  gh repo create classinfo-board --private --source . --push   # 首次创建并推送
  gh repo view --web                                            # 日常查看
  ```
- **泄露应急**：一旦发现秘密被提交——立即作废该秘密（改管理员密码：删 `backend/data/admin.json` 重启；重新登录 ehall 使旧 Cookie 失效），再清理历史（小仓库直接重做初始提交 / `git filter-repo`），最后force push 并通知所有克隆者重新克隆。

## 7. 已知风险与待办

1. **`backend/test-group.mjs` 直写生产 `shares.json`**（读-改-写绕过原子写入与服务器内存态，可能被后端下次保存覆盖或反向污染）。按 SECURITY.md 的隔离原则，测试应改用 `DATA_DIR` 隔离实例 + 预置 token（`test-sync.mjs` 已是正确示范）。待重构。
2. `test-share.mjs` / `test-submit.mjs` 仍直连 5174 生产后端发起请求（不写文件，风险较低），后续一并迁到隔离实例。
