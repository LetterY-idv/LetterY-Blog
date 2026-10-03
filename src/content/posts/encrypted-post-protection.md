---
title: '使用私有仓库保护 Astro 加密文章并实现自动部署'
description: '从仓库拆分、构建前置脚本到 GitHub Actions 通知，完整实现私有加密文章的自动获取、构建与多平台部署。'
published: 2026-10-01
tags:
  - Astro
  - GitHub Actions
  - Cloudflare Workers
  - EdgeOne
  - CI/CD
  - 安全
category: '技术'
slug: encrypted-post-protection
---

## 目标与问题

Astro 静态博客可以在构建阶段加密文章正文，并在浏览器中要求访客输入密码后解密。部署产物虽然只包含密文，但如果文章源文件和密码仍保存在公开仓库中，任何人都可以直接查看仓库并获得明文。

本文以 Firefly 为例，你可以在本fork的提交历史中找到原始的 Github 工作流文件，当然也可以直接访问 [Firefly](https://github.com/CuteLeaf/Firefly) 找到原始工作流文件。

本教程将实现以下目标：

- 公开仓库只保存博客代码、公开文章和部署配置。
- 私有仓库保存受保护文章、图片以及文章密码。
- 执行 `pnpm build` 时自动获取并合并私有文章。
- 私有文章更新后自动通知公开博客仓库重新构建。
- 同一套内容可部署到 GitHub Pages、Cloudflare Workers 和 EdgeOne，当然你也可以连接到其它更多的平台（可能需要一些小小的修改）。
- 本地未配置私有仓库时仍可正常开发和构建公开内容。

## 省流

1. 在 [此处](https://gitee.com/LetterY-idv/LetterY-Blog/blob/master/.github/workflows/deploy.yml) 获取新的 deploy.yml 工作流文件，并替换掉公共仓库内的相应文件。
2. 新建一个私有仓库，例如：

   ```text
   Your-Blog-Private/
   ├── posts/
   │   ├── encrypted-demo.md
   │   └── images/
   │       └── example.avif
   └── .github/
       └── workflows/
           └── notify-blog.yml
   ```

   `posts/` 的内部结构应与公开博客的 `src/content/posts/` 保持一致。构建时会把它递归合并到公开文章目录。其中的文章也要保持与公开文章的头部格式一致。
3. 在 [[#让私有文章更新自动触发公共仓库工作流部署|这里]] 找到 notify-blog.yml，并部署到私有仓库的 `.github/workflows`。
4. 配置仓库变量与机密：
   - 公共仓库：
     - `PRIVATE_CONTENT_REPOSITORY`：仓库名，例如 `Your-Account-Name/Your-Blog-Private`。
     - `PRIVATE_CONTENT_REF`：分支名，未设置时使用 `master`。
     - `PRIVATE_CONTENT_PATH`：仓库中的文章目录，未设置时使用 `posts`。
     - `PRIVATE_CONTENT_TOKEN`：读取私有仓库的PAT令牌。仓库机密。
   - 私有仓库：
     - `BLOG_DEPLOY_TOKEN`：**读/写** 私有仓库的PAT令牌。仓库机密。
5. [[#配置 Cloudflare 与 EdgeOne Deploy Hook|配置 CF Workers Hook 与 EdgeOne Webhook 以启用相关部署]]
6. 注意启用 `HTTPS` 以支持文章解密，否则一直“密码错误”。

## 前情提要

最开始我使用 Github Action 分别完成 Github Pages、Cloudflare Workers 和 EdgeOne Markers（原 Pages）。并在 Actions 流程中签出私有仓库的文章内容并构建，最后通过 Wrangler CLI 和 EdgeOne Cl 直接命令行部署。怎么说呢，可以是可以，但是有那么几个不是那么大的大问题：

- 你要部署到几个平台，就要消耗几倍的 Github Action 时长（Free 版每月2000分钟），而 CF Workers 和 EdgeOne 自带构建，显然分散构建、分别管理更好。
- 要用到一堆访问令牌和之类的东西，配置过程繁琐，且容易搞错。根据权限最小权限最简原则，使用部署平台集成更为方便和管理。
- 本地构建的时候仍然不会自动添加私有文章。

当然也带来了一个问题：私有仓库推送需要手动配置部署平台的部署钩子（Webhook），但相比复杂的 API Token，Webhook 只有一个 URL，配置起来更简单，调用也简单。

如果你仍然想使用上述分工作流的方案，请尝试在本fork内执行：

```bash
git checkout d7f75955f2928333f786e3a45671d80aa130cb0b
```

然后就能找到部署到 CF Workers 的工作流文件，EdgeOne 的工作流文件类似，这里不再提供 ~~（其实本来写了但是还没来得及提交和推送就改变主意了）~~。

## 最终架构

完成后的处理流程如下：

```text
私有内容仓库发生更新
        │
        ├── repository_dispatch ──> 公开博客仓库的 GitHub Actions
        ├── Cloudflare Deploy Hook（可选）
        └── EdgeOne Deploy Hook（可选）
                                      │
                                      ▼
                             执行 pnpm run build
                                      │
                                      ▼
                       prepare:private-content 前置脚本
                                      │
                                      ▼
                     临时克隆并合并私有仓库 posts/
                                      │
                                      ▼
                         Astro 加密、构建并生成 dist/
                                      │
                                      ▼
                    GitHub Pages / Cloudflare / EdgeOne
```

这里最重要的变化是：**获取私有内容不再分散写在每个部署工作流中，而是成为 `pnpm build` 的统一前置步骤。** 因此，无论由哪个平台执行构建，只要提供相同的环境变量，就能得到包含私有文章的完整站点。

## 创建私有内容仓库

新建一个私有仓库，例如：

```text
Your-Blog-Private/
├── posts/
│   ├── encrypted-demo.md
│   └── images/
│       └── example.avif
└── .github/
    └── workflows/
        └── notify-blog.yml
```

`posts/` 的内部结构应与公开博客的 `src/content/posts/` 保持一致。构建时会把它递归合并到公开文章目录。

受保护文章仍使用博客现有的 Frontmatter，例如：

```yaml
---
title: 加密文章示例
published: 2026-10-01
password: '请使用足够强的密码'
passwordHint: '可选的密码提示'
---
```

不要在公开仓库中保留这篇文章的副本，也不要把真实密码写入示例、日志或工作流文件。

## 处理私有内容获取脚本

你可以在 [这里](https://github.com/LetterY-idv/LetterY-Blog/blob/master/scripts/fetch-private-content.ts) 找到构建时自动获取私有仓库内容的脚本

脚本 `scripts/fetch-private-content.ts` 会完成以下工作：

1. 读取私有仓库相关环境变量。
2. 未配置仓库时正常跳过，保证本地开发不受影响。
3. 在系统临时目录中浅克隆指定分支。
4. 验证私有文章目录是否存在。
5. 将私有文章递归合并到 `src/content/posts/`。
6. 无论成功还是失败，都清理临时目录。

用到的环境变量：

```text
PRIVATE_CONTENT_REPOSITORY
PRIVATE_CONTENT_REF
PRIVATE_CONTENT_PATH
PRIVATE_CONTENT_TOKEN
```

其中：

- `PRIVATE_CONTENT_REPOSITORY`：仓库名，例如 `Your-Account-Name/Your-Blog-Private`。
- `PRIVATE_CONTENT_REF`：分支名，未设置时使用 `master`。
- `PRIVATE_CONTENT_PATH`：仓库中的文章目录，未设置时使用 `posts`。
- `PRIVATE_CONTENT_TOKEN`：读取私有仓库的PAT令牌。

获取 Github PAT 令牌的方法不再赘述，不知道可以 Google 一下。你也可以使用 Deploy Key。

核心逻辑如下：

```ts
const repository = process.env.PRIVATE_CONTENT_REPOSITORY?.trim();
const ref = process.env.PRIVATE_CONTENT_REF?.trim() || "master";
const contentPath = process.env.PRIVATE_CONTENT_PATH?.trim() || "posts";
const token = process.env.PRIVATE_CONTENT_TOKEN?.trim();

if (!repository) {
  console.log("[PRIVATE-CONTENT] PRIVATE_CONTENT_REPOSITORY is not configured; skipping.");
  process.exit(0);
}
```

克隆应发生在临时目录中，而不是仓库内部。这样不会污染 Git 工作区，也不会意外把私有仓库的 `.git` 目录带入构建上下文。

合并内容时，应保留公开仓库中已有的文章：

```ts
await cp(source, destination, {
  recursive: true,
  force: true,
});
```

**避坑：** 不要使用下面这种命令：

```bash
rsync -a --delete "$source_dir/" src/content/posts/
```

`--delete` 会删除目标目录中未出现在私有仓库的文件，导致公开文章从本次构建中消失。正确策略是只复制和覆盖同名文件，不删除公开内容。

为了避免私有文件覆盖公开文章，两个仓库中不要使用相同的相对路径或 slug。

## 让所有构建自动获取私有文章

在 `package.json` 中增加独立脚本：

```json
{
  "scripts": {
    "prepare:private-content": "tsx scripts/fetch-private-content.ts"
  }
}
```

然后把它放到正式构建命令的最前面：

```json
{
  "scripts": {
    "build": "pnpm prepare:private-content && npx tsx scripts/generate-github-card-data.ts && npx tsx scripts/generate-lqips.ts && npx tsx scripts/generate-vndb-covers.ts && astro build && npx tsx scripts/prune-pio-assets.ts && npx tsx scripts/subset-fonts.ts && npx tsx scripts/minify-inline-scripts.ts && npx tsx scripts/run-pagefind.ts"
  }
}
```

现在所有平台只需要执行：

```bash
pnpm run build
```

私有文章会在 Astro 收集内容之前完成合并，不再需要在 GitHub Pages、Cloudflare 和 EdgeOne 工作流中复制同一段检出代码。

本地未设置 `PRIVATE_CONTENT_REPOSITORY` 时，脚本会输出跳过提示并正常退出，因此公开内容的日常开发方式不变。

## 配置公开博客仓库

在公开博客仓库的 Actions variables 中配置：

```text
PRIVATE_CONTENT_REPOSITORY=Your-Account-Name/Your-Blog-Private
PRIVATE_CONTENT_REF=master
PRIVATE_CONTENT_PATH=posts
```

在 Actions secrets 中配置：

```text
PRIVATE_CONTENT_TOKEN
```

令牌只需要具备读取私有内容仓库的最小权限。不要把令牌直接写进 Git URL、工作流日志或仓库文件。

GitHub Pages 工作流应把这些值注入真正执行构建的步骤：

```yaml
- name: Build site
  run: pnpm run build
  env:
    PRIVATE_CONTENT_REPOSITORY: ${{ vars.PRIVATE_CONTENT_REPOSITORY }}
    PRIVATE_CONTENT_REF: ${{ vars.PRIVATE_CONTENT_REF }}
    PRIVATE_CONTENT_PATH: ${{ vars.PRIVATE_CONTENT_PATH }}
    PRIVATE_CONTENT_TOKEN: ${{ secrets.PRIVATE_CONTENT_TOKEN }}
```

你也可以在 [这里](https://github.com/LetterY-idv/LetterY-Blog/blob/master/.github/workflows/deploy.yml) 找到写好的工作流文件。

## 配置 GitHub Pages 自动部署

公开博客仓库的 Pages 工作流需要监听代码推送、私有内容通知和手动运行：

```yaml
on:
  push:
    branches: [master]
  repository_dispatch:
    types: [content-updated]
  workflow_dispatch:
```

`content-updated` 是公开仓库和私有仓库之间约定的事件名称，两边必须完全一致。

推荐的执行顺序是：

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

- name: Install dependencies
  run: pnpm install --frozen-lockfile

- name: Check site
  run: pnpm astro check
```

必须先安装 pnpm，再让 `actions/setup-node` 初始化 pnpm 缓存，否则缓存初始化阶段可能找不到 pnpm 可执行文件。或者你直接使用原有工作流文件，即不要 `cache: pnpm` 这一行，这样无需改变执行顺序。

`--frozen-lockfile` 会要求 `package.json` 与 `pnpm-lock.yaml` 保持一致，避免 CI 在部署过程中静默修改依赖解析结果。

## 配置 Cloudflare Workers 和 EdgeOne Markers 部署

Firefly 自带了 `wrangler.jsonc` 不用自己编写，只需遵照文档填写项目名称等即可。

`edgeone.json` 可配置为：

```json
{
  "$schema": "https://cdnstatic.tencentcs.com/edgeone/pages/docs/edgeone.schema.json",
  "outputDirectory": "dist",
  "buildCommand": "pnpm run build",
  "installCommand": "pnpm install --frozen-lockfile",
  "nodeVersion": "24"
}
```

## 让私有文章更新自动触发公共仓库工作流部署

仅修改私有仓库不会自动触发公开仓库的工作流，因此要在私有仓库创建 `.github/workflows/notify-blog.yml`。

这里提供一份写好的yaml文件。

```yaml
name: Notify Blog Repository

on:
  push:
    branches: [ master ] # Adjust branches as needed
  pull_request:
    branches: [ master ] # Adjust branches as needed
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: notify-blog-${{ github.ref }}
  cancel-in-progress: true

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Dispatch content-updated event
        env:
          GH_TOKEN: ${{ secrets.BLOG_DEPLOY_TOKEN }}
          BLOG_REPOSITORY: Your-Account-Name/Your-Blog #这里写你公开仓库或者fork的路径
        run: |
          set -euo pipefail

          if [ -z "$GH_TOKEN" ]; then
            echo 'BLOG_DEPLOY_TOKEN is not configured.' >&2
            exit 1
          fi

          curl --fail-with-body \
            --request POST \
            --header 'Accept: application/vnd.github+json' \
            --header "Authorization: Bearer $GH_TOKEN" \
            --header 'X-GitHub-Api-Version: 2022-11-28' \
            "https://api.github.com/repos/${BLOG_REPOSITORY}/dispatches" \
            --data "$(jq -nc \
              --arg event_type 'content-updated' \
              --arg repository "$GITHUB_REPOSITORY" \
              --arg ref "$GITHUB_REF_NAME" \
              --arg sha "$GITHUB_SHA" \
              '{event_type: $event_type, client_payload: {repository: $repository, ref: $ref, sha: $sha}}')"

      - name: Trigger Cloudflare deploy hook
        env:
          DEPLOY_HOOK_URL: ${{ secrets.CLOUDFLARE_DEPLOY_HOOK_URL }}
        run: |
          if [ -z "$DEPLOY_HOOK_URL" ]; then
            echo 'Cloudflare deploy hook is not configured; skipping.'
            exit 0
          fi
          curl --fail-with-body --request POST "$DEPLOY_HOOK_URL"

      - name: Trigger EdgeOne deploy hook
        env:
          DEPLOY_HOOK_URL: ${{ secrets.EDGEONE_DEPLOY_HOOK_URL }}
        run: |
          if [ -z "$DEPLOY_HOOK_URL" ]; then
            echo 'EdgeOne deploy hook is not configured; skipping.'
            exit 0
          fi
          curl --fail-with-body --request POST "$DEPLOY_HOOK_URL"
```

你也可以只在 `posts/**` 发生变化时通知：

```yaml
on:
  push:
    branches: [master]
    paths:
      - 'posts/**'
  workflow_dispatch:
```

通知步骤通过 GitHub REST API 向公开仓库发送 `repository_dispatch`：

```yaml
- name: Dispatch content-updated event
  env:
    GH_TOKEN: ${{ secrets.BLOG_DEPLOY_TOKEN }}
    BLOG_REPOSITORY: Your-Account-Name/Your-Blog
  run: |
    set -euo pipefail

    if [ -z "$GH_TOKEN" ]; then
      echo 'BLOG_DEPLOY_TOKEN is not configured.' >&2
      exit 1
    fi

    curl --fail-with-body \
      --request POST \
      --header 'Accept: application/vnd.github+json' \
      --header "Authorization: Bearer $GH_TOKEN" \
      --header 'X-GitHub-Api-Version: 2022-11-28' \
      "https://api.github.com/repos/${BLOG_REPOSITORY}/dispatches" \
      --data '{"event_type":"content-updated"}'
```

私有仓库需要配置：

```text
BLOG_DEPLOY_TOKEN
```

该令牌用于向目标博客仓库创建事件，注意：该 PAT 令牌需要对公共仓库有 **读/写** 的权限，因为创建事件为“写”操作。另外，Deploy Key 只适用于 Git over SSH，不能替代 GitHub REST API 的认证令牌。

## 配置 Cloudflare 与 EdgeOne Deploy Hook

如果 Cloudflare 或 EdgeOne 项目由平台自己的 Git 集成负责构建，也可以在私有仓库更新后额外调用 Deploy Hook。

在 CF Workers 和 EdgeOne 的项目设置页面很容易就能找到 “Webhook” 或者“部署钩子”的配置，你可以得到各一个 URL，这里不再赘述相关方法。

在私有仓库配置以下可选 Secrets：

```text
CLOUDFLARE_DEPLOY_HOOK_URL
EDGEONE_DEPLOY_HOOK_URL
```

不要在步骤的 `if:` 表达式中直接检查 `secrets`。将 Secret 注入环境变量，再由 shell 判断是否配置：

```yaml
- name: Trigger Cloudflare deploy hook
  env:
    DEPLOY_HOOK_URL: ${{ secrets.CLOUDFLARE_DEPLOY_HOOK_URL }}
  run: |
    if [ -z "$DEPLOY_HOOK_URL" ]; then
      echo 'Cloudflare deploy hook is not configured; skipping.'
      exit 0
    fi
    curl --fail-with-body --request POST "$DEPLOY_HOOK_URL"
```

EdgeOne 使用相同结构，只需替换 Secret 名称和提示文本。未配置 Hook 时步骤会正常跳过，不会让整个通知任务失败。

如果 `repository_dispatch` 已经触发同一个平台的部署工作流，就不应再为该平台重复配置 Deploy Hook，否则一次文章更新可能产生两次部署。

## 验证完整链路

建议按以下顺序验证：

### 1. 验证无配置的本地构建前置步骤

```bash
env -u PRIVATE_CONTENT_REPOSITORY \
  -u PRIVATE_CONTENT_REF \
  -u PRIVATE_CONTENT_PATH \
  -u PRIVATE_CONTENT_TOKEN \
  pnpm prepare:private-content
```

预期结果是输出跳过提示并以成功状态退出。

### 2. 验证私有内容获取

在本地临时设置变量并运行：

```bash
pnpm prepare:private-content
```

确认私有文章被复制到 `src/content/posts/`，同时公开文章仍然存在。

验证结束后不要提交合并进来的私有源文件，应立即清理本地测试副本。

### 3. 验证项目检查和构建

```bash
pnpm astro check
pnpm run build
```

确认构建日志没有输出密码、Token 或文章明文。

### 4. 验证私有仓库通知

修改私有仓库 `posts/` 下的一篇文章并推送，然后检查：

- 私有仓库的通知工作流成功。
- 公开仓库收到 `content-updated` 事件。
- GitHub Pages、Cloudflare 和 EdgeOne 中实际启用的平台开始部署。
- 部署后的文章页面要求输入密码。
- 输入正确密码后正文与图片可以正常显示。

## 常见问题

### 输入文章密码总是提示密码错误

请检查你是否开启了 `HTTPS`。

你需要使用 `HTTPS` 才能正常解密文章，所以开发服务器下加密文章输入密码总是显示“密码错误”。

### 构建中没有私有文章

依次检查：

- `PRIVATE_CONTENT_REPOSITORY` 是否已传给执行 `pnpm run build` 的步骤。
- `PRIVATE_CONTENT_TOKEN` 是否有权读取私有仓库。
- `PRIVATE_CONTENT_REF` 是否为真实存在的分支。
- `PRIVATE_CONTENT_PATH` 是否指向仓库中的目录。
- 平台构建命令是否确实执行了项目的 `pnpm run build`。

### 私有仓库更新后没有重新部署

检查私有仓库的 `BLOG_DEPLOY_TOKEN`、目标仓库名称，以及发送和监听的事件名是否都为 `content-updated`。

### 公开文章在构建后消失

检查合并逻辑中是否使用了 `rsync --delete`。私有内容应合并到公开目录，而不是把公开目录同步成私有仓库的镜像。

### Actions 提示找不到 pnpm

把 `pnpm/action-setup` 放在带有 `cache: pnpm` 的 `actions/setup-node` 之前。

### 自动部署执行了两次

检查同一平台是否同时响应 `repository_dispatch` 和 Deploy Hook。保留一种触发方式即可。

## 安全边界

该方案保护的是公开仓库中的文章源文件和构建密码，但静态前端加密仍有明确边界：

- CI 构建环境会短暂接触文章明文和密码。
- 浏览器需要获得密文才能在客户端解密。
- 弱密码可能遭到离线猜测，因此应使用足够长且不可预测的密码。
- Actions 日志不能输出 Token、密码、完整 Frontmatter 或文章正文。
- 所有令牌都应遵循最小权限原则并定期轮换。
- 临时克隆目录必须在构建结束后删除。

如果内容需要用户身份认证、访问撤销、审计记录或禁止未授权用户下载密文，就不应只依赖静态站点前端解密，而应使用服务端鉴权后再返回内容。

## 完成后的效果

完成以上配置后，整个发布链路变为：

1. 在私有仓库编写并推送受保护文章。
2. 私有仓库向公开博客发送 `content-updated` 事件。
3. 公开博客的部署工作流开始运行。
4. `pnpm run build` 自动克隆并合并私有内容。
5. Astro 在构建阶段生成加密后的静态页面。
6. GitHub Pages、Cloudflare Workers 或 EdgeOne 发布构建产物。

私有文章的明文和密码不再进入公开仓库，而所有部署平台使用同一条构建入口，避免多份工作流逻辑逐渐不一致。这种方案适合需要为少量博客文章增加密码保护，同时希望继续保留 Astro 静态部署体验的场景。
