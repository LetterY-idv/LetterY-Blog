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
series: 'Astro 站点内容安全保护'
seriesOrder: 2
---

本文在是在完成加密文章保护的基础上进行的，如果没有完成，请先阅读：

[[encrypted-post-protection]]

静态博客的相册加密通常发生在构建阶段。浏览器最终拿到的页面可以只包含密文，但如果相册配置、访问密码和图片列表仍然保存在公开仓库中，任何人都可以绕过前端密码框，直接查看仓库获得原始内容。

因此，本次改造沿用了加密文章的保护思路：公开仓库继续保存博客框架和普通相册，受保护相册则迁移到私有仓库。构建开始前，由统一脚本临时读取私有仓库，将相册资源复制到 `public/gallery`，并根据私有 JSON 配置生成 TypeScript 配置文件。

## 省流

步骤如下：

1. 在 [Gitee](https://gitee.com/LetterY-idv/LetterY-Blog/blob/master/.github/workflows/deploy.yml) 获取新的 deploy.yml 工作流文件，并替换掉公共仓库内的相应文件。
2. 在 [Gitee](https://gitee.com/LetterY-idv/LetterY-Blog/blob/master/scripts/fetch-private-content.ts) 获取新的脚本文件 `scripts/fetch-private-content.ts`。
3. 在 [Gitee](https://gitee.com/LetterY-idv/LetterY-Blog/blob/master/src/config/privateGalleryConfig.generated.ts) 获取新的配置文件，并放在 `src/config/privateGalleryConfig.generated.ts`。
4. 在私有仓库中新建 `gallery` 部分，结构大致如下：

   ```text
   gallery/
   ├── galleryConfig.json
   └── encrypted-test/
       └── urls.txt
   ```

   以后新增相册时，只需要增加一个相册目录，并在 `galleryConfig.json` 中增加对应配置。
5. 把加密相册的 `urls.txt` 或图片迁移进私有仓库的 `gallery/相册ID` 目录中。
6. 参见 [[#配置私有相册元数据]] 将公有仓库的 `src/config/galleryConfig.ts` 中的 **加密相册相关部分相册信息** 迁移到私有仓库的 `gallery/galleryConfig.json` 中。
7. 在公开仓库的 Actions variables 中添加 `PRIVATE_GALLERY_PATH=gallery`。
8. 确认 Actions secrets 中已经配置可读取私有仓库的 `PRIVATE_CONTENT_TOKEN`。
9. 推送代码并重新部署，构建脚本会自动复制相册并生成配置。

## 思路

公开仓库只保留以下内容：

- 相册页面和加密组件
- 普通公开相册
- 私有相册配置的空白生成文件
- 构建前获取私有内容的脚本

私有仓库保存：

- 受保护相册的图片或 `urls.txt`
- 相册名称、描述、标签和日期
- `password` 与 `passwordHint`

构建时的处理顺序为：

1. 使用只读令牌检出私有仓库。
2. 将私有相册目录复制到 `public/gallery`。
3. 读取 `gallery/galleryConfig.json`。
4. 生成 `src/config/privateGalleryConfig.generated.ts`。
5. 合并公开和私有相册配置。
6. 执行 Astro 构建，由加密组件生成浏览器端需要的密文。

## 调整私有仓库目录

私有仓库中的相册目录采用以下结构：

```text
gallery/
├── galleryConfig.json
└── encrypted-test/
    └── urls.txt
```

相册目录名必须与配置中的 `id` 一致。例如 `id` 为 `encrypted-test` 时，对应资源应放在 `gallery/encrypted-test` 中。

`urls.txt` 每行保存一个图片地址：

```text
# 每行一个图片 URL，支持 jpg/png/webp/avif/gif 后缀
# # 号开头的行为注释，空行会被忽略
https://example.com/photo-01.webp
https://example.com/photo-02.jpg
```

如果图片本身也需要隐藏，就不应使用可公开访问的固定外链。公开图床只能隐藏相册入口和配置，不能阻止知道原始 URL 的人直接访问图片。

## 配置私有相册元数据

在私有仓库的 `gallery/galleryConfig.json` 中保存受保护相册配置：

```json
[
  {
    "id": "encrypted-test",
    "name": "加密相册示例",
    "description": "只有输入正确密码才能查看的相册。",
    "location": "示例地点",
    "date": "2026-02-01",
    "tags": ["加密相册", "示例"],
    "password": "请替换为强密码",
    "passwordHint": "仅提供不会暴露密码的提示"
  }
]
```

不要使用示例密码或容易猜测的短密码。由于解密发生在浏览器中，这种方案适合家庭照片、活动记录等低到中等敏感内容，不适合身份证件、财务资料或其他高敏感文件。

## 在构建前复制私有相册

统一的 `scripts/fetch-private-content.ts` 除了合并私有文章，还会读取 `PRIVATE_GALLERY_PATH`。默认值为 `gallery`。

脚本遍历私有相册根目录下的子目录，并复制到公开项目的 `public/gallery`：

```ts
const galleryEntries = await readdir(privateGalleryRoot, {
  withFileTypes: true,
});

for (const entry of galleryEntries) {
  if (!entry.isDirectory()) continue;

  await cp(
    resolve(privateGalleryRoot, entry.name),
    resolve(galleryDestination, entry.name),
    { recursive: true, force: true },
  );
}
```

这种写法不依赖固定的 `albums` 中间目录。私有仓库新增相册时，只需要增加同级目录，不必修改复制逻辑。

## 生成私有相册配置

构建脚本读取 `galleryConfig.json`，验证顶层结构为数组，然后生成 TypeScript 文件：

```ts
const albums = JSON.parse(await readFile(configSource, "utf8"));

if (!Array.isArray(albums)) {
  throw new Error("Private gallery config must contain an array of albums.");
}

await writeFile(
  galleryConfigDestination,
  `import type { GalleryAlbum } from "@/types/galleryConfig";\n\nexport const privateGalleryAlbums: GalleryAlbum[] = ${JSON.stringify(albums, null, "\t")};\n`,
);
```

公开仓库中的 `galleryConfig.ts` 只负责合并配置：

```ts
import type { GalleryConfig } from "@/types/galleryConfig";
import { privateGalleryAlbums } from "./privateGalleryConfig.generated";

export const galleryConfig: GalleryConfig = {
  albums: [
    // 公开相册
    ...privateGalleryAlbums,
  ],
};
```

这样，密码和私有相册元数据不会直接出现在公开仓库的手写配置中。

## 配置 GitHub Actions

在公开博客仓库的 Actions variables 中配置：

```text
PRIVATE_CONTENT_REPOSITORY=Your-Account-Name/Your-Blog-Private
PRIVATE_CONTENT_REF=master
PRIVATE_CONTENT_PATH=posts
PRIVATE_GALLERY_PATH=gallery
```

在 Actions secrets 中配置：

```text
PRIVATE_CONTENT_TOKEN
```

构建步骤需要注入这些变量：

```yaml
- name: Build site
  run: pnpm run build
  env:
    PRIVATE_CONTENT_REPOSITORY: ${{ vars.PRIVATE_CONTENT_REPOSITORY }}
    PRIVATE_CONTENT_REF: ${{ vars.PRIVATE_CONTENT_REF }}
    PRIVATE_CONTENT_PATH: ${{ vars.PRIVATE_CONTENT_PATH }}
    PRIVATE_GALLERY_PATH: ${{ vars.PRIVATE_GALLERY_PATH }}
    PRIVATE_CONTENT_TOKEN: ${{ secrets.PRIVATE_CONTENT_TOKEN }}
```

令牌应遵循最小权限原则，只授予读取目标私有仓库所需的权限。不要把令牌写入 Git URL、仓库文件或构建日志。

## 本地开发方式

本地未设置 `PRIVATE_CONTENT_REPOSITORY` 时，获取脚本会跳过私有内容，普通公开相册仍可正常开发。

需要预览私有相册时，可以通过本地环境变量指定私有仓库和令牌，再执行统一构建命令：

```bash
pnpm run build
```

不要把包含令牌的环境文件提交到 Git。构建结束后，也应检查 `public/gallery` 和生成的配置文件是否被 `.gitignore` 正确排除，避免误提交私有内容。

## 安全边界

本次改造解决的是公开仓库泄露明文配置和相册清单的问题，但它并不等同于服务器端鉴权。

需要特别注意：

- 浏览器端解密意味着访问者会在成功解锁后获得明文内容。
- 静态站点无法撤销已经被访问者保存的图片。
- 公共图床地址一旦泄露，密码页无法阻止直接访问。
- 弱密码可能遭到离线猜测，应使用足够长且不可预测的密码。
- 高敏感内容应改用 Cloudflare Access、对象存储签名 URL 或带会话鉴权的服务端方案。

## 最终效果

完成改造后，公开仓库仍然可以保留 fork 上游跟踪和自动部署能力，同时不再直接保存受保护相册的配置、密码与图片列表。

私有仓库更新相册后，只需触发公开仓库的部署流程。构建脚本会在 Astro 收集相册内容之前完成复制和配置生成，不需要在不同部署平台的工作流中重复维护相同逻辑。
