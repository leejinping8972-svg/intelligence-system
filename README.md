# 知衡情报

面向美国、墨西哥和越南市场的大健康跨境情报后台前端。项目基于 [Vben Admin](https://github.com/vbenjs/vue-vben-admin) 与 Ant Design Vue 构建。

## 在线预览

https://leejinping8972-svg.github.io/intelligence-system/

当前为前端交互演示：样本品牌、站点、商品、广告和指标均为虚构数据；研究任务不会调用真实付费接口。

## 已实现

- 三国市场切换、情报总览与趋势图表。
- 关键词来源、28 天变化、商品关联数和站点关联数。
- 独立站主要产品、类别、股权背景、官网依据及组合筛选。
- 商品功效卖点、成分分析、独立站关联、筛选与对比。
- 研究任务成本试算、建议预算和可配置单价。
- 广告观察、机会研究、人工审核、数据导入和监控任务。
- Logo、后台名称、工作区名称等基础配置。

## 本地运行

需要 Node.js 22.18+ 和 pnpm。

```bash
pnpm install --frozen-lockfile
pnpm --filter @vben/web-antd exec vite --host 127.0.0.1 --port 5666 --strictPort
```

访问 http://127.0.0.1:5666 。

## 验证与构建

```bash
pnpm --filter @vben/web-antd run typecheck
node --experimental-strip-types --test tests/hci-import.test.mjs
pnpm --filter @vben/web-antd exec vite build --mode demo
```

主要业务代码位于 `apps/web-antd/src/views/intelligence`。

## 许可与来源

Vben Admin 相关代码遵循仓库内的 MIT License。世界地图边界数据来自 Natural Earth 110m 数据集。
