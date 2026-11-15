---
title: '使用私有仓库保护加密文章并实现自动部署'
description: '从仓库拆分、构建前置脚本到 GitHub Actions 通知，完整实现私有加密文章的自动获取、构建与多平台部署。'
published: 2026-10-01
updated: 2026-10-17
tags:
  - Astro
  - GitHub Actions
  - Cloudflare Workers
  - EdgeOne
  - CI/CD
  - 安全
image: './images/astro-logo-dark.png'
category: '技术'
slug: encrypted-post-protection
series: '静态站点内容安全保护'
seriesOrder: 1
---

静态站点通常在构建时加密文章，再由浏览器解密。但页面上的密码框不会保护公开仓库中的源文件：只要文章和密码仍提交在仓库里，别人就能直接查看。

如果博客主题通过 fork 使用，公开仓库往往还有上游同步的便利。想保留这项便利，同时不公开受保护文章，可以把文章单独存入私有仓库，在构建前再取回并合并。

下面以 Astro 和 Firefly 为例介绍配置过程。整体思路也适用于其他静态站点生成器，但脚本和构建命令需要按项目调整。若你还要保护相册，可以看：

[[encrypted-gallery-protection]]

## 省流优先

1. 从 [Gitee 仓库](https://gitee.com/LetterY-idv/LetterY-Blog/blob/master/scripts/fetch-private-content.ts) 获取 `scripts/fetch-private-content.ts` 并放入博客仓库。
2. 从 [Gitee 仓库](https://gitee.com/LetterY-idv/LetterY-Blog/blob/master/package.json) 获取并覆盖`package.json`，或手动将前置脚本加入其中的 `build` 命令。
3. 新建私有仓库，将受保护文章放进 `posts/`，目录结构与博客文章目录保持一致。
4. 在 Github 上创建相关 PAT 令牌和变量/机密，在公开仓库和部署平台配置私有仓库变量及读取令牌。
5. 从 [[#让私有文章更新后触发部署|本文]] 获得 `notify-blog.yml` 放入私有仓库，并配置 `BLOG_DEPLOY_TOKEN`。
6. 确认两边都使用 `content-updated` 事件；需要时配置平台 Deploy Hook。
7. 启用 HTTPS 访问。

需要配置的变量和令牌：

| 变量 | 类型 | 用途 | 默认值 | 部署位置 |
| --- | --- | --- | --- | --- |
| `PRIVATE_CONTENT_REPOSITORY` | Variables | 私有仓库目标，格式为 `账号/仓库名` | 无；未设置时跳过 | 公共仓库 |
| `PRIVATE_CONTENT_REF` | Variables | 要获取的分支 | `master` | 公共仓库 |
| `PRIVATE_CONTENT_PATH` | Variables | 仓库内的文章目录 | `posts` | 公共仓库 |
| `PRIVATE_CONTENT_TOKEN` | **Secrets** | 读取私有仓库的令牌 | 无 | 公共仓库 |
| `BLOG_DEPLOY_TOKEN` | **Secrets** | 触发自动构建部署的通知令牌 | 无 | **私有仓库** |

整个过程可以概括为：

```text
私有仓库更新
    └── 通知公开博客仓库或部署平台
            └── pnpm run build
                    └── 获取并合并私有文章
                            └── Astro 构建并部署
```

本文以 Firefly 为例。你可以在本 fork 的提交历史中查看工作流，也可以参考 [Firefly 上游仓库](https://github.com/CuteLeaf/Firefly)。

::github{repo="CuteLeaf/Firefly"}

相关文件也可以在本站的 GitHub 和 Gitee 仓库中找到。

::github{repo="LetterY-idv/LetterY-Blog"}

下面按配置顺序展开说明。

## 准备私有内容仓库

先新建一个私有仓库，用来存放受保护的文章和图片。目录可以参考下面的结构：

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

`posts/` 里的结构要和博客的 `src/content/posts/` 对应，这样构建时才能直接合并。文章仍沿用博客现有的 Frontmatter，例如：

```yaml
---
title: 加密文章示例
published: 2026-10-01
password: '请使用足够强的密码'
passwordHint: '可选的密码提示'
---
```

记得从公开仓库中移除私有文章的副本；示例和工作流里也不要放真实密码。

## 让构建过程取回私有文章

接下来，把 [`scripts/fetch-private-content.ts`](https://github.com/LetterY-idv/LetterY-Blog/blob/master/scripts/fetch-private-content.ts) 放到博客仓库的同一路径。脚本会根据环境变量浅克隆私有仓库，检查文章目录后，将内容合并到 `src/content/posts/`，最后清理临时文件。

脚本通过以下环境变量定位并读取私有仓库：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `PRIVATE_CONTENT_REPOSITORY` | 私有仓库，格式为 `账号/仓库名` | 无；未设置时跳过 |
| `PRIVATE_CONTENT_REF` | 要获取的分支 | `master` |
| `PRIVATE_CONTENT_PATH` | 仓库内的文章目录 | `posts` |
| `PRIVATE_CONTENT_TOKEN` | 读取私有仓库的令牌 | 无 |

本地没有配置私有仓库时，脚本会直接跳过，不影响公开文章的开发和构建。

合并时有一点需要特别留意：只把私有文章复制进来，不要顺手删除目标目录中的文件。使用递归复制并覆盖同名文件即可；不要使用 `rsync --delete`，否则公开仓库里独有的文章也会被删掉。最好也避免两边的文章使用相同路径或 slug，以免互相覆盖。

然后在 `package.json` 里注册获取脚本，并把它放在构建命令的最前面：

```json
{
  "scripts": {
    "prepare:private-content": "tsx scripts/fetch-private-content.ts",
    "build": "pnpm prepare:private-content && npx tsx scripts/generate-github-card-data.ts && npx tsx scripts/generate-lqips.ts && npx tsx scripts/generate-vndb-covers.ts && astro build && npx tsx scripts/prune-pio-assets.ts && npx tsx scripts/subset-fonts.ts && npx tsx scripts/minify-inline-scripts.ts && npx tsx scripts/run-pagefind.ts"
  }
}
```

从这以后，各平台仍然只需执行 `pnpm run build`。私有文章会先合并，再交给 Astro 构建，不需要在每份部署工作流里重复编写获取逻辑。

## 配置构建环境

现在要让构建环境知道去哪里取文章。在公开博客仓库的 GitHub Actions **Variables** 中添加：

```text
PRIVATE_CONTENT_REPOSITORY=Your-Account-Name/Your-Blog-Private
PRIVATE_CONTENT_REF=master
PRIVATE_CONTENT_PATH=posts
```

再到 **Secrets** 中添加 `PRIVATE_CONTENT_TOKEN`。这个令牌只需要读取私有仓库的权限，也不要把它写进 Git URL、日志或仓库文件。

别忘了把这些值传给实际执行构建的步骤。GitHub Pages 工作流示例如下：

```yaml
- name: Build site
  run: pnpm run build
  env:
    PRIVATE_CONTENT_REPOSITORY: ${{ vars.PRIVATE_CONTENT_REPOSITORY }}
    PRIVATE_CONTENT_REF: ${{ vars.PRIVATE_CONTENT_REF }}
    PRIVATE_CONTENT_PATH: ${{ vars.PRIVATE_CONTENT_PATH }}
    PRIVATE_CONTENT_TOKEN: ${{ secrets.PRIVATE_CONTENT_TOKEN }}
```

此外，Pages 工作流要监听私有仓库稍后会发送的事件：

```yaml
on:
  push:
    branches: [master]
  repository_dispatch:
    types: [content-updated]
  workflow_dispatch:
```

这里的 `content-updated` 就是两边约定的事件名，发送方和接收方必须完全一致。完整工作流可以参考 [`deploy.yml`](https://github.com/LetterY-idv/LetterY-Blog/blob/master/.github/workflows/deploy.yml)。

Cloudflare Workers 和 EdgeOne 也一样：需要在实际运行构建的环境中配置前面提到的四个变量。Firefly 已经包含 `wrangler.jsonc`，EdgeOne 项目则可以使用下面的构建配置：

```json
{
  "$schema": "https://cdnstatic.tencentcs.com/edgeone/pages/docs/edgeone.schema.json",
  "outputDirectory": "dist",
  "buildCommand": "pnpm run build",
  "installCommand": "pnpm install --frozen-lockfile",
  "nodeVersion": "24"
}
```

## 让私有文章更新后触发部署

最后，在私有仓库中创建 `.github/workflows/notify-blog.yml`。下面的示例会在 `posts/` 有更新时通知公开仓库；如果你使用 Cloudflare 或 EdgeOne 的 Deploy Hook，也可以一并触发：

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
            --header "Authorization: Bearer ${GH_TOKEN}" \
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

别忘了在私有仓库的 **Secrets** 中配置以下凭据：

- `BLOG_DEPLOY_TOKEN`：用于向公开仓库创建 `repository_dispatch` 事件。使用 Fine-grained PAT 时，为目标仓库授予创建该事件所需的 Contents 写入权限。
- `CLOUDFLARE_DEPLOY_HOOK_URL`、`EDGEONE_DEPLOY_HOOK_URL`：可选；仅在需要直接调用对应平台的部署钩子时配置。

如果 `repository_dispatch` 已经能触发某个平台的部署，就不必再为它配置 Deploy Hook，否则一次更新可能会部署两次。没有用到的平台，对应步骤也可以删掉。

## 完整验证

配置完成后，先在没有私有仓库配置的情况下运行前置脚本，确认它会正常跳过：

```bash
env -u PRIVATE_CONTENT_REPOSITORY \
  -u PRIVATE_CONTENT_REF \
  -u PRIVATE_CONTENT_PATH \
  -u PRIVATE_CONTENT_TOKEN \
  pnpm prepare:private-content
```

然后在已配置私有仓库变量和令牌的环境中运行 `pnpm prepare:private-content`。确认私有文章已复制到 `src/content/posts/`，公开文章也仍然存在。本地测试结束后，请删除合并进来的私有源文件，不要将它们提交到公开仓库。

最后，从私有仓库提交一篇文章的更新，检查通知工作流是否成功、公开仓库是否收到 `content-updated`，以及启用的平台是否开始部署。部署完成后打开文章页面，试着输入密码，确认正文和图片都能正常显示。

## 排错

- **文章提示密码错误：** 确认页面是通过 HTTPS 访问的；加密文章在不满足解密条件的环境中可能无法正常解密。
- **构建中没有私有文章：** 确认四个环境变量已传入构建步骤，令牌有权读取私有仓库，分支和目录名称也正确；同时检查平台执行的是否是 `pnpm run build`。
- **更新后没有部署：** 检查 `BLOG_DEPLOY_TOKEN`、目标仓库名，以及发送和监听的事件名是否都是 `content-updated`。
- **公开文章消失：** 检查合并脚本有没有删除目标目录里的文件，尤其要确认没有使用 `rsync --delete`。
- **部署重复：** 看看该平台是不是同时被 `repository_dispatch` 和 Deploy Hook 触发。

## 安全边界

这套方案可以避免将文章源文件和密码提交到公开仓库，但 CI 构建时仍会短暂接触明文，浏览器也必须取得密文才能解密。因此，请使用足够强的密码，不要在日志中输出令牌、密码或文章内容，并定期轮换令牌。

如果还需要用户身份认证、撤销访问、审计记录，或阻止未授权用户下载密文，静态站点的前端解密就不够用了，应改用服务端鉴权。
