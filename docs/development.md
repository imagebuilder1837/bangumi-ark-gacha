# 开发与交付

要求 Node.js 与 npm。在仓库根目录运行：

```sh
npm ci                 # 从锁文件安装开发依赖
npm run format         # 格式化模块、构建脚本和测试
npm run format:check   # 只读格式检查
npm test               # 模块、真实 DOM 和生成产物测试
npm run build          # 重新生成 src/index.user.js
npm run check          # 只读检查格式、语法、测试、版本和产物一致性
```

`src/metadata.txt` 是人工维护的 userscript 头部模板，版本号来自 `package.json`；构建将 ESM 源码打包成可读、未压缩的单个 IIFE，安装和更新地址仍指向 `src/index.user.js`。不要直接编辑生成产物；修改模块后运行 `npm run build`，并提交生成产物和锁文件。`npm run check` 不修改文件。

模块职责见 [模块指南](module-guide.md)，具体行为规则见 [规格说明](spec.md)。测试在模块公开接口注入请求、存储、时钟和随机数。

## 人工验收待办

在 Bangumi 实际收藏页面检查首次加载、自动后台更新、失败选择、抽卡与卡片打开，以及响应式网格、字体、封面和动画视觉效果；jsdom 测试不能验证实际布局。
