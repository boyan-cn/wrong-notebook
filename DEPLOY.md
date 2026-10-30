# 错题本 · 群晖（Synology）发布指南

一个自托管的家庭错题本：孩子拍照上传错题，调用 AI 大模型识别题目、分析错因、梳理知识点，并按「简单 / 适中 / 困难」生成举一反三练习。

- 后端：FastAPI + SQLite（单文件数据库，无需额外数据库服务）
- 前端：原生 HTML/CSS/JS，移动端适配，拍照后可直接选图上传
- 部署：单个 Docker 容器，数据全部保存在挂载目录，方便备份和迁移

---

## 一、功能与账号说明

| 角色 | 权限 |
| --- | --- |
| 管理员（默认 `admin` / `admin123`） | 配置 AI 服务商（实例名称、BaseURL、模型名称、API Key）、设为默认、测试连接；管理自己的错题 |
| 普通用户 | 手机号 + 用户名 + 密码 + **孩子年级**自主注册、登录；上传分析错题、查看/编辑/删除自己的错题、生成举一反三练习；**看不到也无法调用 AI 设置** |

- 年级是注册必填项（小学一年级至高中三年级），会随账号保存；AI 分析错因和生成练习时会按该年级的课程范围和认知水平调整讲法与难度，避免超纲。
- 年级可在登录后点击顶栏的年级徽标随时修改（例如升年级后）。
- 不同用户的错题互相隔离，普通用户访问管理接口会返回 403。
- AI 服务由管理员统一配置，普通用户直接使用默认服务，无需也不可设置。
- 支持科目：语文、数学、英语、物理、化学、生物、政治、历史、地理、科学、其他，可按科目筛选。

---

## 二、部署前准备

1. 群晖 DSM 7.2 及以上，已安装 **Container Manager**（套件中心搜索安装）。
2. 确认 NAS 可以访问外网（调用 OpenAI / 通义 / 智谱等云端模型需要）。
3. 准备一个目录存放项目，例如 `/volume1/docker/wrong-notebook`。
4. 准备一个支持**图片理解**的模型和 API Key，例如：
   - OpenAI：`https://api.openai.com/v1`，模型 `gpt-4o`
   - 阿里云百炼：`https://dashscope.aliyuncs.com/compatible-mode/v1`，模型 `qwen-vl-max`
   - 智谱：`https://open.bigmodel.cn/api/paas/v4`，模型 `glm-4v`
   - 本地 Ollama：`http://<NAS局域网IP>:11434/v1`，模型如 `qwen2.5vl`（需自行部署 Ollama）

> 注意：纯文本模型（如 `gpt-3.5`、`qwen-turbo`）无法识别照片，请务必选择多模态模型。

---

## 三、上传项目文件

把整个项目目录上传到 NAS，推荐用 **File Station**：

```
/volume1/docker/wrong-notebook/
├── app/                    # 后端代码（不要漏）
├── web/                    # 前端页面（不要漏）
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── .env.example
└── .env                    # 由 .env.example 复制后修改
```

操作步骤：

1. 打开 File Station，进入 `docker` 共享文件夹，新建 `wrong-notebook` 文件夹。
2. 将本地项目中的 `app`、`web`、`Dockerfile`、`docker-compose.yml`、`requirements.txt`、`.env.example` 上传进去。
3. 复制 `.env.example` 并重命名为 `.env`，用文本编辑器修改：

```ini
ADMIN_USERNAME=admin
ADMIN_PASSWORD=换成你自己的强密码
APP_SECRET=用 openssl rand -hex 32 生成的一串随机字符
MAX_UPLOAD_MB=12
TOKEN_DAYS=30
```

> `ADMIN_PASSWORD` 只在**首次初始化**（数据库不存在时）创建管理员账号。数据库已存在后再改这个值不会改密码，请登录后在页面右上角「修改密码」。
>
> `APP_SECRET` 留空也能运行，系统会自动生成并保存在 `data/secret.key`；但请确保 `data` 目录持久化，否则每次重建容器都会让登录状态失效。

---

## 四、部署方式

### 方式 A：Container Manager 图形界面（推荐）

1. 打开 **Container Manager → 项目 → 新增**。
2. 项目名称填 `wrong-notebook`。
3. 路径选择 `/volume1/docker/wrong-notebook`。
4. 来源选择「使用现有的 docker-compose.yml」（若界面只支持上传，请先按上文把整个目录上传好，再选择该目录）。
5. 点击「下一步」，如有提示选择「构建」/「启动」，等待镜像构建和容器启动完成。
6. 首次构建需要拉取 Python 基础镜像并安装依赖，视网络情况耐心等待。
7. 在「容器」列表中确认 `wrong-notebook` 状态为「运行中」。

### 方式 B：SSH 命令行（构建更可控）

用管理员账号 SSH 登录 NAS（控制面板 → 终端机和 SNMP → 启用 SSH）：

```bash
cd /volume1/docker/wrong-notebook
sudo docker compose up -d --build
sudo docker compose ps
sudo docker compose logs -f --tail=100
```

旧版 DSM 若没有 `docker compose`，改用：

```bash
sudo docker-compose up -d --build
```

看到类似 `Uvicorn running on http://0.0.0.0:8000` 即启动成功。

### 方式 C：本地构建后导入镜像（可选）

如果 NAS 构建太慢，可在有 Docker 的电脑上构建并导出：

```bash
docker build -t wrong-notebook:1.0.0 .
docker save wrong-notebook:1.0.0 -o wrong-notebook.tar
```

把 `wrong-notebook.tar` 上传到 NAS，在 Container Manager「映像 → 新增 → 从文件添加」导入；随后用项目方式启动 compose（image 名称保持一致），或直接创建容器：

- 端口：`9080 -> 8000`
- 存储：`/volume1/docker/wrong-notebook/data -> /data`
- 环境变量：参考 `.env`

---

## 五、首次访问与配置

1. 浏览器访问：`http://<NAS的局域网IP>:9080`
   - 例如 `http://192.168.1.10:9080`
2. 使用管理员账号登录（默认 `admin` / `admin123`，若已在 `.env` 修改则用新密码）。
3. 右上角「修改密码」，把默认密码改掉。
4. 点击顶部「AI 设置」→「添加 AI 服务」，填写：
   - **实例名称**：自定义，如「OpenAI 主力」
   - **BaseURL**：`https://api.openai.com/v1`（填到 `/v1` 即可，系统会自动拼接 `/chat/completions`；也可直接填完整的 `/chat/completions` 地址）
   - **模型名称**：`gpt-4o`
   - **API Key**：你的密钥
   - 勾选「设为默认使用的 AI 服务」
5. 保存后点「测试连接」，出现「连接成功」即配置正确。
6. 退出管理员，注册一个普通用户（用户名 + 手机号 + 孩子年级 + 密码），开始使用。

> 普通用户不会看到「AI 设置」入口；即使手动访问 `/#/settings` 也会被跳回错题本。

---

## 六、使用流程

1. 点击「＋ 添加错题」，选择或拖入题目照片（支持 JPG/PNG/WEBP，前端会自动压缩到 1600px）。照片会进入**框选裁剪**界面：拖动四角手柄调整范围、拖动选框内部移动位置，也可「全选」恢复整张图或「重新选择」换图；只保留题目区域后再上传。
2. 点「AI 智能分析」，等待 AI 返回题目原文、正确答案、知识点、错因分析、解题思路；可逐项手动修正，选择科目后保存。
3. 在列表中按科目、状态（待复习/已掌握）、关键词筛选；点击卡片查看详情。
4. 详情页底部「举一反三」，可分别生成**简单、适中、困难**三档各 3 道同类题，点「查看答案」展开答案与解析。
5. 掌握后点「✓ 标记为已掌握」，之后可随时改回待复习。

AI 识别失败时不会丢失照片：页面会提示失败原因，你仍可手动填写内容后保存。

---

## 七、HTTPS 与域名（建议）

家庭内网可直接用 `IP:9080`。若要从外网访问，**务必先配置 HTTPS 和强密码**：

1. 控制面板 → 登录门户 → 高级 → 反向代理服务器 → 新增。
2. 配置：
   - 来源：`HTTPS`，端口 `443`，主机名 `wrong.example.com`
   - 目的地：`HTTP`，主机名 `127.0.0.1`，端口 `9080`
3. 为域名申请证书（控制面板 → 安全性 → 证书 → Let's Encrypt）。
4. 路由器只映射 443，不要直接暴露 9080。
5. 可结合 DSM 防火墙，仅允许需要的地区/网段访问。

> 应用已支持 `--proxy-headers`，反向代理后图片与登录态可正常工作。

### 语音输入需要 HTTPS

主页「问 AI 老师」和添加错题里的「我有疑问」都带麦克风按钮。按浏览器安全策略，**只有 HTTPS（或 localhost）页面才能使用麦克风**，直接以 `http://NAS_IP:9080` 访问时点击麦克风只会提示需要 HTTPS。

- 语音识别由浏览器完成（Chrome / Edge / 安卓 Chromium 内核支持；iPhone Safari、微信内置浏览器不支持，此时麦克风按钮会自动隐藏）
- 识别服务需要联外网，国内部分网络环境下 Chrome 可能提示连接失败
- 若手机上使用微信打开，建议改用系统 Chrome/Edge 浏览器访问

---

## 八、数据、备份与恢复

所有数据都在挂载目录：

```
data/
├── app.db          # 用户、错题、练习、AI 服务配置（API Key 明文存储于 SQLite）
├── app.db-wal      # SQLite 运行日志
├── secret.key      # 自动生成的令牌签名密钥
└── uploads/<用户ID>/<随机文件名>.jpg
```

**备份（推荐停容器后打包，避免 WAL 写入不一致）：**

```bash
cd /volume1/docker/wrong-notebook
sudo docker compose stop
sudo tar -czf /volume1/backup/wrong-notebook-$(date +%Y%m%d).tar.gz data
sudo docker compose start
```

也可以用 Hyper Backup 备份整个 `/volume1/docker/wrong-notebook` 目录（建议安排在不使用的时间段）。

**恢复：**

```bash
sudo docker compose stop
sudo rm -rf data
sudo tar -xzf wrong-notebook-20260101.tar.gz   # 解出 data 目录
sudo docker compose start
```

> `data/app.db` 内含 API Key，请把备份文件当作敏感文件保管；不要把 `data` 目录提交到代码仓库。

---

## 九、升级

```bash
cd /volume1/docker/wrong-notebook
# 覆盖上传新的 app/、web/、requirements.txt 等文件，保留 data/ 和 .env
sudo docker compose up -d --build
```

数据目录不会被覆盖。升级前建议先按上一节做一次备份。

---

## 十、常见问题排查

| 现象 | 原因与处理 |
| --- | --- |
| 页面打不开 | `sudo docker compose ps` 看容器是否运行；`logs` 看启动报错；确认 NAS 防火墙放行 9080 |
| 登录后刷新又退出 | `data/secret.key` 丢失或 `data` 未正确挂载；确认 compose 的 `./data:/data` 生效 |
| AI 分析提示「无法连接 AI 服务」 | BaseURL 写错、NAS 无外网、服务商需要代理；检查是否需要 `/v1` |
| AI 分析提示 HTTP 401/403 | API Key 错误、余额不足或没有模型权限 |
| AI 分析提示超时 / 返回格式异常 | 模型不支持图片输入，或 BaseURL 指向的不是 OpenAI 兼容接口 |
| 上传图片 413 | 图片超过 `MAX_UPLOAD_MB`；调大环境变量并重启容器 |
| 端口被占用 / 端口映射报错 | 修改 `docker-compose.yml` 端口映射**左侧**（主机）端口即可，如 `"9080:8000"` 改成 `"9090:8000"`；**右侧 8000 是容器内服务端口，不能改**，否则访问会连接失败 |
| 忘记管理员密码 | 环境变量只在首次建库生效。可在 NAS 上进入容器执行重置（请先备份 `data`）：<br>`sudo docker compose exec wrong-notebook python -c "from app import db; u=db.find_user_by_account('admin'); db.update_user_password(u['id'], '新密码')"` |
| 想接入本地 Ollama | BaseURL 填 `http://<NAS局域网IP>:11434/v1`；若 Ollama 在宿主机，可在 compose 增加 `extra_hosts: ["host.docker.internal:host-gateway"]` 后使用 `http://host.docker.internal:11434/v1` |
| 需要看接口文档 | 访问 `http://<NAS IP>:9080/api/docs`（Swagger UI） |

查看日志：

```bash
sudo docker compose logs -f --tail=200
```

重启 / 停止：

```bash
sudo docker compose restart
sudo docker compose down
```

---

## 十一、本地开发（可选）

需要 Python 3.11+：

```bash
python -m venv .venv
# Windows
.\.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

访问 `http://127.0.0.1:8000`。本地数据同样写入项目下的 `data/` 目录。

---

## 十二、安全提醒

1. **上线第一件事：修改默认管理员密码。**
2. 外网访问必须使用 HTTPS，不要把 9080 明文端口直接映射到公网。
3. 应用目前是家庭自用定位：普通用户只能访问自己的错题；上传的图片使用 32 位随机文件名，但 `/uploads/` 路径本身不做登录校验，请勿把图片直链公开分享。
4. API Key 保存在 SQLite 中，请限制 NAS 共享目录权限，并妥善保管备份文件。
5. 建议定期更新基础镜像与依赖，关注模型服务商的安全公告。
