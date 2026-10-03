---
title: '使用私有仓库保护 Astro 加密文章并自动部署'
description: '将敏感文章与密码迁移到私有仓库，并通过 GitHub Actions 自动构建和部署到 GitHub Pages 与 Cloudflare Workers。'
published: 2026-10-01
tags:
  - Astro
  - GitHub Actions
  - Cloudflare Workers
  - CI/CD
  - 安全
category: '技术'
slug: encrypted-post-protection
---

## 背景

本站使用 Astro 构建静态博客，并支持为文章设置访问密码。原来的加密过程发生在构建阶段，最终部署产物只包含密文，但文章源文件和密码仍保存在公开 GitHub 仓库中。

这意味着前端加密虽然能阻止普通访客直接阅读网页内容，却无法阻止别人浏览公开仓库并找到文章明文和密码。

为解决这一问题，我将内容拆分为两个仓库：

- 公开博客仓库保存程序代码、配置和公开文章。
- 私有内容仓库保存需要保护的文章、图片和构建时密码。

部署时由 GitHub Actions 临时拉取私有内容，将其合并到公开文章目录，再完成静态构建。私有源文件不会被提交到公开仓库。

## 整体架构

部署链路如下：

```text
私有内容仓库 push
        ↓
发送 repository_dispatch 事件
        ↓
公开博客仓库收到 content-updated
        ↓
检出公开博客与私有内容
        ↓
合并公开文章和私有文章
        ↓
构建 Astro 静态站点
        ↓
部署到 GitHub Pages 和 Cloudflare Workers
```

公开博客仓库自身发生推送时，也会直接执行两套部署工作流。

## 私有内容仓库结构

私有仓库只需要保存文章及其资源，例如：

```text
LetterY-Blog-Private/
├── posts/
│   ├── encrypted-demo.md
│   └── images/
│       └── example.avif
└── .github/
    └── workflows/
        └── notify-blog.yml
```

工作流构建时会把这里的 `posts/` 合并到公开仓库的 `src/content/posts/`。

## 公开博客仓库配置

公开博客仓库需要配置以下 Repository variables：

```text
PRIVATE_CONTENT_REPOSITORY=LetterY-idv/LetterY-Blog-Private
PRIVATE_CONTENT_REF=master
PRIVATE_CONTENT_PATH=posts
```

它们分别表示私有仓库名称、需要检出的分支，以及私有文章所在目录。

同时需要配置以下 Repository secrets：

```text
PRIVATE_CONTENT_TOKEN
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

其中：

- `PRIVATE_CONTENT_TOKEN` 用于在构建阶段读取私有内容仓库。
- `CLOUDFLARE_API_TOKEN` 用于发布 Cloudflare Worker。
- `CLOUDFLARE_ACCOUNT_ID` 用于指定 Cloudflare 账户。

读取私有内容仓库也可以使用只读 Deploy Key，从而避免为检出操作使用长期个人令牌。

## 合并文章时保留公开内容

合并私有文章时不能使用带 `--delete` 的 `rsync`：

```bash
rsync -a --delete "$source_dir/" src/content/posts/
```

`--delete` 会删除目标目录中不存在于私有仓库的文件，因此公开仓库原有文章会从本次构建目录中消失。

正确做法是仅合并文件：

```bash
rsync -a "$source_dir/" src/content/posts/
```

这样最终构建会同时包含公开文章和私有文章。如果两个仓库存在相同的相对路径，后复制的私有文件仍会覆盖公开文件，因此应避免重名。

## GitHub Pages 自动部署

GitHub Pages 工作流监听两种主要事件：

```yaml
on:
  push:
    branches: [master]
  repository_dispatch:
    types: [content-updated]
  workflow_dispatch:
```

- 公开博客仓库推送到 `master` 时自动部署。
- 私有仓库发送 `content-updated` 时自动部署。
- 必要时可以在 Actions 页面手动运行。

构建阶段依次完成以下操作：

1. 检出公开博客仓库。
2. 检出私有内容仓库。
3. 合并私有文章。
4. 安装 pnpm 和 Node.js。
5. 使用锁文件安装依赖。
6. 执行 Astro 检查和完整构建。
7. 上传并发布 GitHub Pages 构建产物。

## Cloudflare Workers 自动部署

Cloudflare Workers 使用独立工作流，但内容检出和合并过程与 GitHub Pages 相同。

构建时设置：

```yaml
env:
  CF_WORKERS: '1'
```

Astro 配置根据 `CF_WORKERS` 启用 Cloudflare Adapter。构建完成后执行：

```bash
pnpm exec wrangler deploy
```

`wrangler.jsonc` 中指定静态资源目录：

```json
{
  "name": "lettery-blog",
  "compatibility_date": "2026-09-30",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist"
  }
}
```

网站本身会生成并处理 `404.html`，因此不需要 SPA 路由回退配置。

## pnpm 初始化顺序

当 `actions/setup-node` 配置了 pnpm 缓存时：

```yaml
with:
  node-version: '24'
  cache: pnpm
```

它会在初始化阶段调用 pnpm 获取缓存目录。如果这时 pnpm 尚未安装，工作流会报错：

```text
Unable to locate executable file: pnpm
```

因此应先安装 pnpm，再初始化带缓存配置的 Node.js：

```yaml
- name: Setup pnpm
  uses: pnpm/action-setup@v6
  with:
    version: 12.8.2
    run_install: false

- name: Setup Node.js
  uses: actions/setup-node@v7
  with:
    node-version: '24'
    cache: pnpm
```

`cache: pnpm` 只缓存 pnpm 的包存储，用于缩短后续依赖下载时间。它不会缓存 `node_modules`，也不能替代 `pnpm install`。

生产部署使用：

```bash
pnpm install --frozen-lockfile
```

这样 CI 不会自行修改锁文件。如果 `package.json` 与 `pnpm-lock.yaml` 不一致，工作流会立即失败，避免部署出依赖版本不可重复的构建产物。

## 私有仓库推送后通知博客仓库

私有内容仓库包含一个通知工作流。它只在 `posts/**` 发生变化时触发，并向博客仓库发送 `repository_dispatch` 请求：

```yaml
on:
  push:
    branches: [master]
    paths:
      - 'posts/**'
  workflow_dispatch:
```

请求使用的事件名称为：

```text
content-updated
```

这必须与公开博客仓库工作流中的事件类型完全一致。

私有仓库需要配置 Repository secret：

```text
BLOG_DEPLOY_TOKEN
```

该令牌建议使用 Fine-grained personal access token，并且只授权目标博客仓库。它需要适当的仓库写权限，不是因为工作流会修改代码，而是因为创建 `repository_dispatch` 事件属于对目标仓库执行写操作。

Deploy Key 适合 Git over SSH 的克隆和推送，不能直接代替调用 GitHub REST API 所需的 `BLOG_DEPLOY_TOKEN`。如果不希望使用长期 PAT，可以改用 GitHub App 生成短期令牌。

## 安全边界

这种方案解决的是源文件和密码暴露在公开仓库中的问题，但仍需理解静态站点加密的边界：

- 构建环境会短暂接触文章明文和密码。
- 部署产物包含可在浏览器中解密的密文。
- 密码强度不足时，密文仍可能被离线猜测。
- GitHub Actions 日志中不能输出文章内容、密码或令牌。
- 私有内容令牌应遵守最小权限原则并定期轮换。

如果内容要求服务端身份认证、访问审计、撤销权限或禁止用户获取密文，就不应继续使用纯静态前端解密，而应改为通过服务端鉴权后按需返回内容。

## 最终效果

完成拆分后：

- 公开仓库不再保存受保护文章的明文和密码。
- 公开文章和私有文章会在构建阶段安全合并。
- 公开博客代码推送后会自动部署。
- 私有文章推送后会自动触发博客仓库重新构建。
- GitHub Pages 与 Cloudflare Workers 使用相同内容源并分别发布。
- 依赖安装由锁文件约束，构建结果更加稳定、可复现。

这种结构保留了 Astro 静态站点简单、快速的优点，同时把敏感内容从公开源代码中分离出来，适合个人博客中需要密码保护、但不要求完整服务端权限系统的内容。
