# 安全与数据防护说明（SECURITY.md）

> 2026-10-15 数据事故（shares.json 两次丢失）后由安全负责人落实的防护与运维手册。

## 架构与信任边界

- 局域网用户 → **5173**（Vite dev / 生产 root server.mjs，监听 0.0.0.0）→ `/api` 代理 → **5174 后端（仅监听 127.0.0.1）**。外界永远摸不到 5174，也无法绕过代理直连数据。
- 后端数据目录 `backend/data/` 含**明文 ehall Cookie**（每人账号文件内），已在 `.gitignore` 排除，严禁外传/入库存。
- 信任模型：局域网内成员半可信（同班同学）。主机用户电脑是单点（开机+进程存活服务才可用）。

## 已实现的防护（backend/server.mjs）

### 数据耐久（防丢失，事故根源治理）
1. **原子写入**：所有 JSON（shares/sessions/账号/admin）先写临时文件再 `rename` 原子替换——崩溃/断电不会留下半个文件。
2. **滚动备份**：每次保存成功后快照到 `backend/data/backups/<kind>/`，自动保留最近 20 份（`BACKUP_KEEP`）。备份目录：
   - `backups/shares/`、`backups/sessions/`、`backups/accounts/<学号>/`
3. **损坏自恢复**：启动加载时主文件损坏 → 自动从最新可用备份恢复到内存**并立即回写主文件**，日志打印 `[recover]`。
4. **写失败可见**：保存失败不再静默吞掉，日志会打印 `[save] ... 保存失败`。
5. **merge 语义同步**（并行开发引入，安全上更优）：`PUT /data` 只增/改不清空，删除必须走 `/data/delete` 显式 id 白名单——异常客户端无法一键清空云端。

### 认证与暴力破解防护
1. **登录限速**：`/auth/admin-login` 5 次/10 分钟、`/auth/login` 10 次/10 分钟（按真实客户端 IP，超限 429）。限速在内存中，重启清零。
2. **管理员密码 scrypt 慢哈希**：新注册/重置直接用 scrypt；旧 sha256 格式在首次成功登录时自动升级（无需手动迁移）。
3. **时序安全比较**（timingSafeEqual）防时序侧信道。
4. 会话 token 24 字节随机，30 天有效，落盘 `sessions.json`（保存时自动清理过期项）。

### Web 安全
1. **CORS 全关**：应用与 API 同源（走 5173 代理），不再返回 `Access-Control-Allow-Origin: *`，恶意网页无法跨域读接口。
2. **附件下载加固**：`X-Content-Type-Options: nosniff` + `Content-Disposition: attachment`（带 UTF-8 文件名），上传的 HTML/SVG 不会被浏览器内联执行。
3. **安全响应头**（生产入口 root server.mjs）：CSP（`default-src 'self'`、禁 object/frame）、nosniff、X-Frame-Options、Referrer-Policy。Vite dev 不加 CSP（HMR 需要内联脚本）。
4. **错误脱敏**：未预期异常只返回「服务器内部错误」，堆栈/路径只进后端日志；无效 Cookie 登录返回 401 + 友好提示。
5. **请求体校验**：非法 JSON → 400；超限 → 413。

### 资源配额与防灌爆（2026-10-15 二轮）
- 单文件 ≤100MB；每账号云盘 ≤512MB；每共享板附件 ≤1GB（超限 413）。
- **内容截断**：共享板标题 ≤200、DDL ≤40、要求正文 ≤20000 字符（服务端 `clampStr`，投稿/上架/审核改写全部生效）。
- **数量上限**：共享板总数 ≤500；每板待审投稿 ≤50；每板已上架作业/附件各 ≤200；负责人申请记录 ≤2000；课程标识 ≤200 字符——单账号无法灌爆 shares.json。
- **会话治理**：删除 `admin.json` 重置密码后，重启自动作废所有旧管理员会话（普通用户会话不受影响）；启动时自动清理崩溃残留的 `.tmp` 文件。
- **Vite dev 安全头**：nosniff / X-Frame-Options / Referrer-Policy（CSP 仅生产入口提供，HMR 需要内联脚本）；`xfwd: true` 已生效，限速按真实局域网 IP 分桶。

## 已知接受的风险
1. **局域网明文 HTTP**：Cookie/token 在局域网内可被嗅探。自签 HTTPS 需每台设备装证书，班级场景成本高于收益，暂接受。
2. **ehall Cookie 明文落盘**：加密需要本机存密钥，收益有限；靠目录权限与不入库兜底。
3. 5174 后端与数据都在同一台主机，主机被入侵则全部失守（主机可信前提）。
4. 限速桶在后端内存中，后端重启清零（对班级场景足够）。

## 运维手册

```bash
# 重启后端（数据不丢：会话/共享板都在磁盘）
netstat -ano | grep :5174   # 找 PID
taskkill //F //PID <pid>
# 项目目录下：
powershell "Start-Process node -ArgumentList 'backend/server.mjs' -WorkingDirectory <项目绝对路径> -WindowStyle Hidden"

# 测试环境隔离跑（不影响生产数据）
PORT=5194 DATA_DIR=<测试目录> node backend/server.mjs
```

- **管理员密码重置**：删 `backend/data/admin.json` 重启，新密码打印在日志（环境变量 `ADMIN_USER`/`ADMIN_PASS` 可指定）。
- **手动恢复数据**：从 `backend/data/backups/shares/` 取时间戳最新的拷贝覆盖 `backend/data/shares.json`（先停后端）。事故前快照另存于 `backend/manual-backups/`。
- **隔离测试**：`DATA_DIR` 环境变量可把存储指到任意目录，测试严禁直连生产数据目录。
