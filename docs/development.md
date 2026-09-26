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

#3 阶段检测第一页变化后直接后台更新；串行获取列表，切换状态取消旧范围获取，评分缓存按原获取时间保留 72 小时，手动刷新不清除评分缓存。关闭弹窗不中断获取；不再提供用户停止按钮。中央并行调度和切换后保留旧列表任务属于后续阶段。

## 人工验收待办

在 Bangumi 实际收藏页面检查首次加载、自动后台更新、失败选择、抽卡与卡片打开，以及响应式网格、字体、封面和动画视觉效果；jsdom 测试不能验证实际布局。
