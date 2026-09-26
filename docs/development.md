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

职责：`collection-cache` 维护收藏和评分存储；`bangumi-client` 处理 HTTP 与 HTML；`draw-engine` 处理评分、随机选取与卡片数据；`gacha-session` 管理获取、抽卡生命周期和用户命令；`gacha-view` 负责 DOM 与样式；较薄的 `main.mjs` 组装并启动。测试在正常模块接口注入请求、存储、时钟和随机数。

此阶段只保持原有更新确认、串行获取、停止和评分有效期等行为，后续阶段再调整。`CONTEXT.md` 的 72 小时评分缓存定义是最终目标；#2 刻意保留旧实现的七天有效期及手动刷新清除评分缓存，#3 才替换这些业务规则。回归测试使用当前阶段预期，不把后续规则提前当成本阶段行为。

## 人工验收待办

在 Bangumi 实际收藏页面检查首次加载、更新确认、抽卡与卡片打开，以及响应式网格、字体、封面和动画视觉效果；jsdom 测试不能验证实际布局。
