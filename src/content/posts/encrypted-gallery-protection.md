---
title: '使用私有仓库保护 Astro 加密相册并实现自动部署'
description: '从相册资源拆分、私有配置生成到构建阶段合并，完整实现 Astro 加密相册的源码保护与自动部署。'
published: 2026-11-08
tags:
  - Astro
  - GitHub Actions
  - CI/CD
  - 相册
  - 安全
category: '技术'
image: './images/astro-logo-dark.png'
slug: encrypted-gallery-protection
series: '静态站点内容安全保护'
seriesOrder: 2
---

静态博客通常在构建时加密相册，再由浏览器解密。不过，页面上的密码框保护不了公开仓库里的源文件。如果相册配置、密码和图片列表仍提交在公开仓库中，别人依然可以直接查看。

做法是把受保护相册放进私有仓库，等到构建前再复制图片并生成配置。部署部分沿用上一篇文章的设置，因此请先完成其中的前置步骤：

[[encrypted-post-protection]]

## 省流优先

1. 完成 [[encrypted-post-protection]] 中的构建与部署配置。
2. 确认获取脚本会复制私有相册，并将 `privateGalleryAlbums` 合并到相册配置。
3. 按 [[#整理私有仓库]] 的结构，将图片和 `galleryConfig.json` 放入私有仓库的 `gallery/`。
4. 在构建环境中设置 `PRIVATE_GALLERY_PATH=gallery`，并传入已有的私有仓库变量和令牌。
5. 通知工作流若设有路径过滤，将 `gallery/**` 加入监听列表；没有设置则无需修改。
6. 运行 `pnpm run build`，并通过 HTTPS 检查相册。

## 检查博客仓库

完成文章保护配置后，再确认博客仓库包含以下私有相册支持：

- [`scripts/fetch-private-content.ts`](https://github.com/LetterY-idv/LetterY-Blog/blob/master/scripts/fetch-private-content.ts) 会复制私有相册资源，并根据 `galleryConfig.json` 生成配置。
- [`src/config/privateGalleryConfig.generated.ts`](https://github.com/LetterY-idv/LetterY-Blog/blob/master/src/config/privateGalleryConfig.generated.ts) 是构建时生成配置的初始文件。
- [`src/config/galleryConfig.ts`](https://github.com/LetterY-idv/LetterY-Blog/blob/master/src/config/galleryConfig.ts) 会把 `privateGalleryAlbums` 合并到公开相册列表。

当前仓库已包含这些改动。若你使用的是较早版本，请先同步相关文件，并确认 `package.json` 的 `build` 命令会先运行 `pnpm prepare:private-content`。

## 整理私有仓库

在私有仓库中按以下结构存放文件：

```text
├── posts/
└── gallery/
    ├── galleryConfig.json
    └── encrypted-test/
        └── urls.txt
```

获取脚本也会检查文章目录是否存在。因此，即使私有仓库只存相册，也要保留 `posts/` 目录。完成文章保护配置后，这个目录通常已经存在。

每个相册都要有自己的子目录，目录名必须与配置中的 `id` 一致。图片可以直接放在目录里；如果使用 `urls.txt`，每行填写一个图片地址：

```text
https://example.com/photo-01.webp
https://example.com/photo-02.jpg
```

然后在 `gallery/galleryConfig.json` 中填写受保护相册的元数据：

```json
[
  {
    "id": "encrypted-test",
    "name": "加密相册示例",
    "description": "需要输入密码才能查看。",
    "location": "示例地点",
    "date": "2026-02-01",
    "tags": ["加密相册", "示例"],
    "password": "请替换为强密码",
    "passwordHint": "仅提供不会暴露密码的提示"
  }
]
```

将受保护相册的配置从公开仓库的 `src/config/galleryConfig.ts` 移到这个 JSON 文件中，公开配置里只保留公开相册。

如果图片本身也需要保密，就不要使用任何人都能访问的固定外链。公开图床的 URL 一旦泄露，密码页无法阻止他人直接打开图片。

## 配置构建环境

在公开博客仓库的 Actions **Variables** 中添加：

```text
PRIVATE_GALLERY_PATH=gallery
```

构建环境还需要文章保护配置中的 `PRIVATE_CONTENT_REPOSITORY`、`PRIVATE_CONTENT_REF`、`PRIVATE_CONTENT_PATH` 和 `PRIVATE_CONTENT_TOKEN`。请把前三项设为 **Variables**，把令牌设为 **Secrets**，并只授予读取私有仓库所需的权限。记得将这些值传给实际执行 `pnpm run build` 的步骤；如果使用 Cloudflare Workers 或 EdgeOne，也要在相应的构建环境中配置。

脚本默认从 `gallery/` 读取相册。只有使用了其他目录名时，才需要调整 `PRIVATE_GALLERY_PATH`。

## 让相册更新触发部署

如果通知工作流没有设置 `paths` 过滤规则，符合工作流分支条件的推送都会触发通知，无需修改。

只有在工作流设置了路径过滤时，才需要把 `gallery/**` 加进列表。例如，若当前只监听文章：

```yaml
paths:
  - 'posts/**'
```

改为：

```yaml
paths:
  - 'posts/**'
  - 'gallery/**'
```

这样，文章或相册更新都会触发通知。令牌、事件名称和部署触发方式继续使用 [[encrypted-post-protection]] 中的配置，不必重复设置。

## 本地预览与验证

没有设置 `PRIVATE_CONTENT_REPOSITORY` 时，脚本会跳过私有内容，公开相册照常可用。要在本地预览私有相册，请先设置私有仓库相关环境变量和令牌，再运行：

```bash
pnpm run build
```

检查私有相册是否已复制到 `public/gallery/`、生成的配置是否包含对应相册，并确认公开相册仍然存在。测试结束后，不要把私有图片、生成的配置文件或含令牌的环境文件提交到公开仓库。

部署后通过 HTTPS 打开相册，确认可以用密码解锁，图片也能正常显示。

## 安全边界

这套方案能避免把受保护相册的配置和图片清单提交到公开仓库，但不等于服务端鉴权：

- 浏览器解密后，访问者仍可以保存图片；静态站点无法撤销已经下载的内容。
- 如果图片存放在公开图床，知道图片 URL 的人仍能直接访问。
- 请使用足够强、难以猜测的密码，并避免在构建日志中输出密码或令牌。
- 如果需要身份认证、撤销访问，或保护高敏感图片，请改用服务端鉴权或签名 URL。
