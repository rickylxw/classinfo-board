# 安全与数据防护（SECURITY.md）

> 「课程信息板」安全措施总览与运维手册。2026-10-15 数据事故（shares.json 一日两丢）后由安全负责人建立，
> 与 [docs/repo-management.md](docs/repo-management.md)（入库边界与仓库规范）配套阅读。

## 0. 架构与信任边界

```
局域网设备 ──HTTP──▶ 5173（Vite dev / 生产 root server.mjs，监听 0.0.0.0）
                        │ /api 代理（追加 x-forwarded-for）
                        ▼
                     5174 后端（仅监听 127.0.0.1）
                        │
                        ▼
                  backend/data/（账号/Cookie/共享板/备份，git 忽略）
```

- 外界只能碰到 5173，永远无法直连 5174 或绕过代理访问数据。
- 信任模型：局域网成员半可信（同班同学）；主机本身可信是前提（数据与后端同机）。
- `backend/data/` 含明文 ehall Cookie 与学号，已在 `.gitignore` 排除，严禁外传/入库。

## 1. 数据耐久（防丢失，事故根源治理）

| 措施 | 实现 | 位置 |
|---|---|---|
| 原子写入 | 所有 JSON 先写临时文件再 `rename` 原子替换，崩溃/断电不留半个文件 | `backend/server.mjs` `writeJsonAtomic()` |
| 滚动备份 | 每次保存成功快照到 `data/backups/<kind>/`（shares / sessions / accounts/<学号>），保留最近 20 份 | `backupJson()`，`BACKUP_KEEP` |
| 损坏自恢复 | 启动加载发现主文件损坏 → 自动从最新备份恢复到内存**并立即回写主文件**，日志 `[recover]` | `restoreLatestBackup()` |
| 写失败可见 | 保存失败必打日志 `[save]`，不再静默吞掉 | 各 save 函数 |
| 防客户端清空 | 服务器权威 merge 语义：`PUT /data` 只增/改，删除必须 `/data/delete` 显式 id 白名单——异常客户端无法一键清空云端 | `mergeAccountData()` / `applyRemovals()` |
| 残留清理 | 启动时清扫上次崩溃遗留的 `.tmp` 临时文件 | `cleanTmpFiles()` |

## 2. 认证与会话

| 措施 | 说明 |
|---|---|
| 密码慢哈希 | 管理员密码 scrypt；旧 sha256 格式首次登录自动升级，无需迁移 |
| 时序安全比较 | `crypto.timingSafeEqual` 防时序侧信道 |
| 登录限速 | `/auth/admin-login` 5 次/10 分钟、`/auth/login` 10 次/10 分钟，超限 429；按真实客户端 IP 分桶（取 `x-forwarded-for` 最后一跳，代理追加，伪造无效） |
| 会话治理 | token 24 字节随机、30 天有效；保存时自动清理过期项 |
| 重置即作废 | 删除 `admin.json` 重置密码后，重启自动作废全部旧管理员会话（普通用户会话不受影响） |
| 角色隔离 | 管理员会话不能当用户会话用（`userAuth`），用户端点与 admin 端点互斥 |
| 身份唯一 | 账号身份 = ehall 课表数据里的学号（XH），无法自选 |

## 3. Web 攻击面

| 措施 | 说明 |
|---|---|
| CORS 全关 | 应用与 API 同源（走 5173 代理），不返回 `Access-Control-Allow-Origin`，恶意网页无法跨域读接口 |
| 附件下载加固 | `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`（UTF-8 文件名），上传的 HTML/SVG 不会被内联执行 |
| 安全响应头 | 生产入口（root server.mjs）加 CSP（`default-src 'self'`、禁 object/iframe）、nosniff、X-Frame-Options、Referrer-Policy；Vite dev 加 nosniff/XFO/Referrer-Policy（CSP 因 HMR 需内联脚本仅生产提供） |
| 前端渲染防线 | Vue 模板转义 + 作业要求富文本经 DOMPurify 净化（白名单放行 `cbimg:`） |
| 路径安全 | 文件 id 一律过 `safeId()`（只留字母数字下划线连字符）；静态服务 normalize + 前缀校验 |
| 错误脱敏 | 未预期异常只返回「服务器内部错误」，堆栈/路径只进日志；无效 Cookie 登录返回 401 + 友好提示 |
| 请求校验 | 非法 JSON → 400；请求体超限 → 413；限速超限 → 429 |

## 4. 资源配额与防滥用

| 维度 | 上限 |
|---|---|
| 单文件 | 100 MB |
| 每账号云盘 | 512 MB（超限 413） |
| 每共享板附件 | 1 GB |
| 共享板总数 | 500 |
| 每板待审投稿（作业/附件各） | 50 |
| 每板已上架作业/附件 | 各 200 |
| 负责人申请记录 | 2000 |
| 课程标识（name\|teacher） | 200 字符 |
| 板内容字段 | 服务端截断：标题 200 / DDL 40 / 要求正文 20000（`clampStr`，投稿/上架/审核改写全路径生效） |

## 5. 验证体系

- **隔离测试设施**：`backend/test-util.mjs` `withTestServer()` —— 每个测试自动起独立实例（临时 DATA_DIR + 随机端口 + 随机管理员密码），物理隔离生产数据与 5174，跑完自清理。
- **四个链路套件全绿**：test-share（17）/ test-submit（13）/ test-group（10）/ test-sync（29，含服务器权威合并、白名单删除、示例数据隔离、原型污染防护）。
- **加固回归**：原子写/备份/自恢复、scrypt 升级、限速 429、字段截断、待审上限、重置踢会话、tmp 清理、下载安全头等 24 项专项断言。
- **提交前门禁**：`git diff HEAD` 后 grep 红线模式（管理员密码 / 真实学号 / Cookie / 内网 IP / 盘符路径），零命中才可提交；测试脚本秘密一律运行时注入（`ADMIN_PASS` 等环境变量）。

## 6. 已知接受的风险

1. **局域网明文 HTTP**：Cookie/token 可被局域网嗅探。自签 HTTPS 需每台设备装证书，班级场景成本高于收益，暂接受。
2. **ehall Cookie 明文落盘**：加密需本机存密钥收益有限，靠目录权限与不入库兜底。
3. **单机单点**：后端与数据同机，主机宕机服务即断；限速桶在后端内存，重启清零（班级场景足够）。
4. **心跳外呼**：登录用户使用期间后端以其 Cookie 轻触 ehall 保活（10 分钟节流），属设计行为。

## 7. 运维手册

```bash
# 重启后端（数据不丢：会话/共享板都在磁盘）
netstat -ano | grep :5174   # 找 PID
taskkill //F //PID <pid>
# 项目目录下：
powershell "Start-Process node -ArgumentList 'backend/server.mjs' -WorkingDirectory <项目绝对路径> -WindowStyle Hidden"

# 隔离跑测试（自动起停隔离实例，绝不碰生产数据）
node backend/test-sync.mjs && node backend/test-share.mjs && node backend/test-submit.mjs && node backend/test-group.mjs

# 手动起隔离实例做实验
PORT=5199 DATA_DIR=<任意临时目录> node backend/server.mjs
```

- **管理员密码重置**：删 `backend/data/admin.json` 重启，新密码打印在日志（可用 `ADMIN_USER`/`ADMIN_PASS` 环境变量指定）；旧管理员会话自动作废。
- **手动恢复数据**：停后端 → 从 `backend/data/backups/shares/` 取时间戳最新快照覆盖 `backend/data/shares.json` → 重启（启动时若主文件损坏会自动走此逻辑）。事故前快照另存于 `backend/manual-backups/`。
- **秘密泄露应急**：立即作废秘密（删 admin.json 重置密码；重新登录 ehall 使旧 Cookie 失效）→ 清历史（小仓库重做初始提交 / `git filter-repo`）→ force push → 通知所有克隆者。详见 repo-management.md §6。
