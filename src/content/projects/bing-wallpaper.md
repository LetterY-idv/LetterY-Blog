---
title: '📸 Bing Wallpaper Archive'
published: 2026-10-16
description: '必应每日壁纸归档及图片 API，自动更新，并可部署到 Cloudflare Workers'
image: ''
tags: []
status: 'published'
draft: false
lang: ''
slug: bing-wallpaper
link:
  - label: "GitHub"
    icon: "fa7-brands:github"
    value: "https://github.com/LetterY-idv/bing-wallpaper"
---

本项目归档 2016-03-05 至今的必应每日壁纸数据，并提供 Cloudflare Workers 网站、JSON API、图片直链接口和批量下载能力。

## 🚀 功能特色

### 必应json数据

- ✅ 配套 JSON 数据使用 GitHub Actions 每日北京时间 00:00 自动更新

### 批处理下载器

- ✅ 支持分辨率选择：原图、4K、2K、1080P 或自定义尺寸
- ✅ 支持按时间范围批量下载
- ✅ 按照年份存放下载的图片
- ✅ 自动跳过已下载文件，避免重复下载
- ✅ 所有图片均通过官方进行下载

注：

- 20190510之前的壁纸只提供下载1080P分辨率

---

## 📦 项目结构

```text
📁 项目根目录
├── 20**/                           # 每天划分的 JSON 数据
├── Bing_zh-CN_all.json             # 所有已归档的必应壁纸 JSON 数据
├── src/                            # Worker 入口、路由与共享逻辑
├── public/                         # Worker 静态资源目录
│   ├── _headers                    # 响应头与缓存策略
│   ├── api-doc/                    # API 文档页面
│   └── Bing_zh-CN_all.json         # 供 Functions 读取的公开数据副本
├── update_bing.sh                  # Bash 脚本：自动下载并合并 JSON 数据
├── bing-wallpaper-downloader.bat   # Windows 批处理脚本，支持交互下载壁纸
└── .github/workflows
    └── update-bing.yml             # GitHub Actions 自动每日更新任务
```

## ⚙️ 使用方式

- 方式一：下载[release](https://github.com/LetterY-idv/Bing-Wallpaper/releases/)中的[bing-wallpaper-downloader.bat](https://github.com/LetterY-idv/Bing-Wallpaper/releases/download/v1.3/bing-wallpaper-downloader.bat)脚本运行后按照提示下载图片。
- 方式二：下载[release](https://github.com/LetterY-idv/Bing-Wallpaper/releases)中的`bing-wallpaper-archive-20xx.zip`图片压缩包。
- 方式三：根据项目的json数据构建自己的下载程序

## ☁️ Cloudflare Git 仓库自动部署

本项目使用 Cloudflare 控制台连接 GitHub 仓库进行自动部署，不需要在 GitHub Actions 中执行 `wrangler deploy`，也不需要配置 Cloudflare API Token。[示例站点](https://bw.lettery.cc.cd)

### 1. 连接仓库

- 进入 Cloudflare 控制台 -> `Workers & Pages` -> `Create` -> `Import a repository`。
- 连接 GitHub，并选择 `LetterY-idv/Bing-Wallpaper` 仓库。
- 生产分支选择 `master`。

### 2. 构建和部署配置

- `Root directory`：`/`
- `Build command`：`pnpm install --frozen-lockfile`
- `Deploy command`：使用 Cloudflare 根据仓库中的 `wrangler.jsonc` 提供的默认部署配置
- Worker 名称：`bing-wallpaper`

仓库中的 `wrangler.jsonc` 定义 Worker 入口 `src/index.js`、静态资源目录 `public` 以及需要优先进入 Worker 的 API 路由。Cloudflare 从仓库构建时会自动读取该配置。

### 3. 自动部署流程

1. GitHub Actions 工作流 `update-bing.yml` 每日北京时间 `00:00` 更新必应数据。
2. 工作流同步 `Bing_zh-CN_all.json` 到 `public/Bing_zh-CN_all.json`。
3. 有数据变化时，工作流提交并推送到 `master`。
4. Cloudflare 检测到仓库提交后自动构建并部署。

GitHub Actions 只负责更新数据，不直接调用 Wrangler 或 Cloudflare API。Cloudflare 部署失败时，可直接在 Cloudflare 项目的构建日志中检查原因。

### 4. 部署后验证

- 首页：`https://<你的域名>/`
- API 文档：`https://<你的域名>/api-doc/`
- 最新一条 JSON：`https://<你的域名>/api/latest`
- 最新 N 条 JSON：`https://<你的域名>/api/latest/10`
- 最新图片直链（Worker 代理）：`https://<你的域名>/img/latest?res=hd&redirect=false`
- 最新图片直链（302 跳转至 Bing 官方原图）：`https://<你的域名>/img/latest?res=hd&redirect=true`

## 🧪 本地预览（Cloudflare Workers）

可通过 Wrangler 在本地预览 Cloudflare Workers 运行环境，包括 Worker 路由和静态资源。

### 1. 环境要求

- Node.js 18+（已安装 pnpm）

### 2. 启动本地服务

在仓库根目录执行：

```bash
pnpm dev --port 8788
```

### 3. 本地访问地址

- 首页：`http://127.0.0.1:8788/`
- API 文档：`http://127.0.0.1:8788/api-doc/`
- 示例接口：`http://127.0.0.1:8788/api/latest/1`

停止服务：`Ctrl + C`

## 📥 数据获取

**GitHub：**

```
# 全量数据
https://raw.githubusercontent.com/LetterY-idv/Bing-Wallpaper/master/Bing_zh-CN_all.json

# 指定日期数据
https://raw.githubusercontent.com/LetterY-idv/Bing-Wallpaper/master/2025/12/20.json
# 指定月份数据
https://raw.githubusercontent.com/LetterY-idv/Bing-Wallpaper/master/2025/12/all.json
# 指定年份数据
https://raw.githubusercontent.com/LetterY-idv/Bing-Wallpaper/master/2025/all.json
```

**jsdelivr：**

```
# 全量数据 cdn加速
https://cdn.jsdelivr.net/gh/LetterY-idv/Bing-Wallpaper/Bing_zh-CN_all.json
# 如果cdn不是最新数据，建议使用下面链接重置
https://purge.jsdelivr.net/gh/LetterY-idv/Bing-Wallpaper/Bing_zh-CN_all.json

# 指定日期数据 cdn加速
https://cdn.jsdelivr.net/gh/LetterY-idv/Bing-Wallpaper/2025/12/20.json
# 指定月份数据 cdn加速
https://cdn.jsdelivr.net/gh/LetterY-idv/Bing-Wallpaper/2025/12/all.json
# 指定年份数据 cdn加速
https://cdn.jsdelivr.net/gh/LetterY-idv/Bing-Wallpaper/2025/all.json
```

**CloudFlare API：**

```
https://<你的域名>/api-doc/
```

## ⚠️ 注意事项

- 可能存在有些图片无法下载的现象，请自行测试。
- 通过git下载的bat文件可能存在换行符是`LF`的情况，需要手动调整，或通过本项目的release进行下载。

## 💖 鸣谢

本项目重构自 [Zhu-junwei/bing-wallpaper-archive](https://github.com/Zhu-junwei/bing-wallpaper-archive)

项目前期初始数据来自[flow2000/bing-wallpaper-api](https://github.com/flow2000/bing-wallpaper-api)
