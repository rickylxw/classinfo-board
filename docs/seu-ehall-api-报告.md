# 东南大学 ehall 教务接口调研报告

> 调研日期：2026-10-13
> 目的：为课程信息板（Classinfo Board）接入东南大学教务课表数据提供依据
> 方法：分析开源项目源码（SEUTimetable、fetch_lecture）+ 接口结构验证

---

## 摘要

东南大学 ehall（网上办事大厅）的课表数据**没有公开 API**，需要先通过学校统一身份认证（`auth.seu.edu.cn`）登录、取得 ehall 会话后，调用 ehall「我的课表」应用的两个内部接口。接口本身是简单的 GET 请求，主要复杂度在登录链（密码需 RSA 加密、偶发设备校验）。

对本项目的推荐集成方式：**方案 A · 浏览器控制台提取脚本**（详见第四节），零密码风险、零跨域问题。

---

## 一、课表接口（需 ehall 登录态）

两个接口都挂在 `ehall.seu.edu.cn` 域名下。浏览器正常登录 ehall 后，同源 cookie 会自动携带，可直接调用。

**应用入口**（ehall「我的课表」）：

```
http://ehall.seu.edu.cn/appShow?appId=4770397878132218
```

### 1. 学期列表

```http
GET http://ehall.seu.edu.cn/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do
```

响应结构：

```json
{
  "datas": {
    "xnxqcx": {
      "rows": [
        { "DM": "2025-2026-1", "MC": "2025-2026学年第一学期", "PX": "..." }
      ]
    }
  }
}
```

- `DM`：学期代码（作为下一个接口的 `XNXQDM` 参数）
- `MC`：学期名称（用于界面展示 / 匹配）
- `PX`：排序值，数值越大学期越新

### 2. 学生课表

```http
GET http://ehall.seu.edu.cn/jwapp/sys/wdkb/modules/xskcb/xskcb.do?XNXQDM=<学期DM>
```

响应结构：

```json
{
  "datas": {
    "xskcb": {
      "totalCount": 20,
      "rows": [ { "KCM": "...", "SKJS": "...", "...": "..." } ]
    }
  }
}
```

若 `totalCount === 0`，通常意味着未登录或该学期未选课。

### 3. rows 字段说明

每行代表一门课的**一个教学时段**（同一门课多时段会出现多行）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `KCM` | string | 课程名 |
| `SKJS` | string | 授课教师（可能为空或字符串 `"null"`，需清洗） |
| `SKXQ` | int | 星期：1=周一 … 5=周五，6=周六，7=周日 |
| `KSJC` | int | 开始节次 |
| `JSJC` | int | 结束节次 |
| `JASMC` | string | 教室地点 |
| `ZCMC` | string | 周次文本，如 `"1-16周"`、`"1-10周(单)"`、`"2,4,6周"` |
| `KCH` | string | 课程号 |
| `JXBQH` | string | 教学班序号 |

周次文本解析规则（来自 SEUTimetable 的实现）：
- `1-16周` → 第 1 到 16 周
- `1-10周(单)` → 1–10 周中的单周
- `2,4,6周` → 逗号分隔的周列表
- 同一字符串内可能混用以上格式，按逗号拆开后逐段解析

### 4. 自行验证方式

浏览器登录 ehall → 打开「我的课表」→ F12 → Network 面板，切换学期时即可看到上述两个 `.do` 请求的完整参数与响应。

---

## 二、登录链（统一身份认证 → ehall 会话）

适用于需要程序化登录的场景（如本地 Node 代理）。来源：fetch_lecture 的 `seu_auth.py`（新版统一身份认证）。

```
用户名/密码
   │  ① POST /auth/casback/getChiperKey   → 拿 RSA 公钥（与 session cookie 配对）
   │  ② RSA(PKCS1_v1_5) 加密密码 → base64
   │  ③ POST /auth/casback/casLogin       → 返回 { success, redirectUrl }
   │  ④ GET redirectUrl（ehall 消费 CAS ticket）
   ▼
ehall 会话 cookie（MOD_AUTH_CAS / mod_auth_session）
   │
   ▼
带 cookie 调第一节的两 个课表接口
```

各步骤细节：

1. **获取公钥**
   ```http
   POST https://auth.seu.edu.cn/auth/casback/getChiperKey
   ```
   返回 `{ "publicKey": "<base64url RSA公钥>" }`，注意公钥与请求时的 session cookie 配对，需用同一个会话完成后续步骤。

2. **加密密码**：RSA PKCS1_v1_5 加密 → base64 编码。Python 用 `pycryptodome`，Node 用内置 `crypto.publicEncrypt`（需把公钥补成 PEM 格式）。

3. **登录**
   ```http
   POST https://auth.seu.edu.cn/auth/casback/casLogin
   Content-Type: application/json

   {
     "username": "一卡通号",
     "password": "<RSA加密后的密码>",
     "service": "http://ehall.seu.edu.cn",
     "loginType": "account",
     "captcha": "",
     "mobileVerifyCode": "",
     "rememberMe": true
   }
   ```
   成功返回 `{ "success": true, "redirectUrl": "http://ehall.seu.edu.cn/...?ticket=ST-..." }`。

4. **换取 ehall 会话**：GET `redirectUrl`，之后持有 ehall 的 `MOD_AUTH_CAS` / `mod_auth_session` cookie，即可调课表接口。

### 已知坑

- **非可信设备校验**：异地 / 新设备登录会触发手机验证码（`mobileVerifyCode` 字段），脚本化登录偶发撞上，需人工介入一次。
- **接口可能改版**：`auth.seu.edu.cn` 属新版认证；若学校后续切换认证方案，此链路需重新逆向。
- **时效性**：本报告基于 2026-10 的开源代码分析，实际字段以抓包为准。

---

## 三、备选通道（不推荐）

- `myseu.cn/ws3`（先声团队第三方聚合 API）：SEU-Curriculum-Export 曾使用，属第三方服务，可用性与持续性不受控，不建议依赖。
- `jwc.seu.edu.cn` 教务处官网：只有新闻公告（SEUTimetable 的 JwcCrawler 即抓这个），无个人课表。
- 选课系统 `newxk.urp.seu.edu.cn`：面向选课场景，课表字段不如 ehall「我的课表」全。

---

## 四、与本项目的集成方案

课程信息板是纯前端 Vue 3 应用 + localStorage，无后端；浏览器直连 ehall 存在跨域限制。三个可行方案：

### 方案 A · 控制台提取脚本（推荐）

在 ehall 课表页的 DevTools Console 里运行提取脚本（同源 XHR，自动带 cookie），导出 JSON，回到课程信息板粘贴导入。

- 优点：不碰密码、无跨域问题、无需改 server.mjs；课表一学期导一次，成本低
- 实现：项目内置「导入课表 JSON」对话框 + 提供提取脚本
- 参考实现（Console 可用版）：

```js
// 在 http://ehall.seu.edu.cn 页面的 Console 中运行
(async () => {
  const termRes = await fetch('/jwapp/sys/wdkb/modules/jshkcb/xnxqcx.do').then(r => r.json());
  const terms = termRes.datas.xnxqcx.rows.sort((a, b) => parseInt(b.PX) - parseInt(a.PX));
  const target = terms[0]; // 最新学期；可改为按 MC 匹配
  const kb = await fetch(`/jwapp/sys/wdkb/modules/xskcb/xskcb.do?XNXQDM=${target.DM}`).then(r => r.json());
  if (!kb.datas || kb.datas.xskcb.totalCount === 0) { console.error('未查到课程，请确认已登录/已选课'); return; }
  const out = { term: target.MC, rows: kb.datas.xskcb.rows };
  copy(JSON.stringify(out)); // Chrome 控制台：已复制到剪贴板
  console.log(`✅ ${target.MC} 共 ${out.rows.length} 条记录，JSON 已复制到剪贴板`);
})();
```

### 方案 B · 扩展 server.mjs 做本地代理

Node 本地服务实现完整登录链（`crypto.publicEncrypt` 原生支持 RSA）+ 拉课表，前端 `fetch('http://localhost:5173/api/timetable')`。

- 优点：全自动，一键同步
- 缺点：一卡通密码经手本地脚本（仅存本机，但仍是敏感面）；需处理偶发设备校验验证码；认证改版时需维护

### 方案 C · 手动贴 cookie

浏览器登录 ehall 后，从 DevTools 复制 `MOD_AUTH_CAS` cookie 填入本地应用设置，server.mjs 代为请求。

- 优点：不碰密码，实现简单
- 缺点：cookie 有效期有限（数小时到数天），每次过期需手动更新

### 结论

课表数据一学期只导入一两次，**方案 A** 的性价比最高：零安全面、零维护成本、接口改版时只需更新一段脚本。

---

## 五、参考项目

| 项目 | 语言/平台 | 本报告取材部分 |
|------|-----------|----------------|
| [SEUTimetable](https://github.com/sakimidare/SEUTimetable) | Kotlin / Android | 课表接口 URL、rows 字段解析、周次解析规则 |
| [fetch_lecture](https://github.com/zhjcreator/fetch_lecture) | Python | 统一身份认证登录链（getChiperKey / casLogin） |
| [SEU-Curriculum-Export](https://github.com/NN708/SEU-Curriculum-Export) | Python | 第三方 myseu.cn 通道（已弃用参考） |
| [iHerald](https://github.com/zltunes/iHerald) | Swift / iOS | 交叉验证教务模块划分 |

---

## 六、实测修正（2026-10-13 真实账号验证）

实际登录 ehall 拉取数据后，发现与第一节的几处差异：

1. **PX 排序方向相反**：`PX` 数值**越小**学期越新（PX=1 是 2026-2027-3 春季学期），不是"越大学期越新"。排序应为升序。
2. **三学期制学期编码**：`DM` 末位 `1` = 暑期学校、`2` = 秋季学期、`3` = 春季学期。10 月对应的是 `2026-2027-2`（秋季学期），`MC` 形如「2026-2027学年秋季学期」而非「第一学期」。
3. **数量字段名**：xskcb.do 响应中行数字段是 `totalSize`（以及 `extParams.msg`），未观察到 `totalCount`。
4. **未来学期返回空**：最新学期（来年春季）rows 为空、`extParams.msg` = "查询学年学期的课程未发布"，提取时应从新到旧找第一个非空学期。
5. **`copy()` 不可用**：非 DevTools 环境的控制台（如内嵌浏览器）没有 `copy()` 函数，脚本需逐级降级（`copy()` → `navigator.clipboard` → 页面内 textarea）。
6. **直接 fetch 可能先失败**：未进入「我的课表」应用（appShow?appId=4770397878132218）前，同源请求 `/jwapp/...` 会因应用会话未初始化而 Failed to fetch；先访问应用入口即可。

以上修正已同步到 `src/timetable.js`（EXTRACT_SCRIPT 与解析逻辑）。
