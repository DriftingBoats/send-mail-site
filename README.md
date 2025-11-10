## 定时发送邮件站点

基于 Node.js + Express 的轻量后台，可通过浏览器创建多个定时邮件任务，并为每个任务绑定独立的 SMTP 设置。

### 功能亮点
- Web 表单即可配置收件人（多选）、主题、正文与首次发送时间
- 支持循环任务（分钟/小时/天/周/月）及“立即发送”按钮
- 任务列表可在弹窗中编辑收件人、主题、正文、发送时间与 SMTP 信息
- 每个任务自带一份 SMTP 配置，方便区分多个发信帐号
- 登录认证内置，凭证存放在 `.env`

### 环境要求
- Node.js 18+
- npm

### 安装与运行
```bash
npm install
cp .env.example .env   # 填写管理员账号等信息
npm run dev            # 或 npm start
```
启动后访问 `http://localhost:3000`。

### 环境变量
| 变量 | 说明 |
| --- | --- |
| `PORT` | Web 服务端口，默认 3000 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 登录后台的账号密码 |
| `SESSION_TTL_MS` | 会话有效期（毫秒，可选，默认 12h） |
| `COOKIE_SECURE` | 生产环境设为 `true` 以强制 HTTPS Cookie |

> SMTP 信息现在随任务保存，不再写在 `.env` 中。表单中填写的主机/端口/账号/密码都会持久化到 `data/tasks.json`。

### 登录流程
1. 打开站点后先看到登录页
2. 输入 `.env` 中的管理员账号即可进入后台
3. 右上角“退出登录”会清除会话并返回登录页

### 任务字段
- **收件人**：可添加多个邮箱；创建后仍可在任务列表里增删
- **发送时间**：第一次发送时间（UTC 保存，本地显示）
- **循环**：勾选后可设定“每 N 个单位发送一次”
- **SMTP 设置**：主机、端口、SSL、发件人、用户名、密码全部跟随任务保存
- **状态**：
  - `scheduled`：已排队
  - `sent`：单次任务已完成
  - `error`：发送失败（表格中展示错误原因）

### API（供二次开发）
- `GET /api/tasks`：获取任务列表
- `POST /api/tasks`：创建任务（结构参考 `public/app.js` 中的 `payload`）
- `DELETE /api/tasks/:id`：删除任务
- `PATCH /api/tasks/:id/recipients`：给任务新增/删除收件人，body 需包含 `action: add|remove` 与 `email`
- `PATCH /api/tasks/:id`：编辑收件人数组、主题、正文、发送时间、循环设置或 SMTP 信息
- `POST /api/tasks/:id/send-now`：立即触发一次发送
- `POST /api/login` / `POST /api/logout` / `GET /api/session`：登录相关接口

### 数据 & 调度
- 所有任务以 JSON 形式保存到 `data/tasks.json`
- `src/scheduler.js` 每分钟巡检任务，到期后调用 `src/services/mailer.js` 发送，并根据循环配置更新 `nextRunAt`

### 目录结构
```
.
├─ public/        # 前端静态文件与交互逻辑
├─ src/
│  ├─ server.js   # Express API + 登录 + 调度入口
│  ├─ scheduler.js
│  ├─ services/mailer.js
│  └─ store/taskStore.js
├─ data/          # 运行时写入 tasks.json
└─ .env.example
```

> 生产部署时请确保存储（尤其是 SMTP 凭据）仅限受信任用户访问，并使用 pm2/systemd 等守护进程运行。

## 部署流程（Vercel 示范）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/DriftingBoats/SendMail-Site)

1. **准备仓库**：确保 `package.json`、`src/`、`public/`、`vercel.json`（若没有请创建）都在根目录，并且 `.env` 未提交。
2. **创建 `vercel.json`（示例）**
   ```json
   {
     "version": 2,
     "builds": [
       { "src": "src/server.js", "use": "@vercel/node" },
       { "src": "public/**", "use": "@vercel/static" }
     ],
     "routes": [
       { "src": "/api/(.*)", "dest": "src/server.js" },
       { "src": "/tasks/(.*)", "dest": "src/server.js" },
       { "src": "/(.*)", "dest": "/public/$1", "fallback": "src/server.js" }
     ]
   }
   ```
3. **配置环境变量（Project Settings → Environment Variables）**
   - `ADMIN_USERNAME` / `ADMIN_PASSWORD`
   - `SESSION_TTL_MS`（可选）
   - `COOKIE_SECURE=true`
4. **部署**：执行 `vercel --prod` 或在 Vercel 控制台点击 Deploy。
5. **重要提示**：Vercel 的 Serverless 函数是无状态的，本项目默认写入 `data/tasks.json`——需要改用数据库或其他持久化存储之后再部署到 Vercel；否则请使用支持长时间运行与磁盘写入的主机（Render、Railway 等）。
