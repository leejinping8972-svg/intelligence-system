import type { RouteRecordRaw } from 'vue-router';
const routes: RouteRecordRaw[] = [
  {
    name: 'HciOverview',
    path: '/overview',
    component: () => import('#/views/intelligence/overview.vue'),
    meta: {
      title: '情报总览',
      icon: 'lucide:layout-dashboard',
      order: 0,
      affixTab: true,
    },
  },
  {
    name: 'HciResearch',
    path: '/research',
    component: () => import('#/views/intelligence/research.vue'),
    meta: { title: '关键词', icon: 'lucide:scan-search', order: 1 },
  },
  {
    name: 'HciTrends',
    path: '/trends',
    component: () => import('#/views/intelligence/trends.vue'),
    meta: {
      title: '趋势洞察',
      icon: 'lucide:chart-no-axes-combined',
      order: 2,
    },
  },
  {
    name: 'HciSelectedKeywords',
    path: '/selected-keywords',
    component: () => import('#/views/intelligence/selected-keywords.vue'),
    meta: { title: '已入选关键词', icon: 'lucide:list-checks', order: 1.5 },
  },
  {
    name: 'HciSites',
    path: '/sites',
    component: () => import('#/views/intelligence/sites.vue'),
    meta: { title: '竞品独立站', icon: 'lucide:globe', order: 3 },
  },
  {
    name: 'HciProducts',
    path: '/products',
    component: () => import('#/views/intelligence/products.vue'),
    meta: { title: '商品情报库', icon: 'lucide:package-search', order: 4 },
  },
  {
    name: 'HciAds',
    path: '/ads',
    component: () => import('#/views/intelligence/ads.vue'),
    meta: { title: '广告观察', icon: 'lucide:megaphone', order: 5 },
  },
  {
    name: 'HciRadar',
    path: '/radar',
    component: () => import('#/views/intelligence/radar.vue'),
    meta: { title: '新品雷达', icon: 'lucide:radar', order: 6 },
  },
  {
    name: 'HciConsumerInsights',
    path: '/consumer-insights',
    component: () => import('#/views/intelligence/consumer-insights.vue'),
    meta: {
      title: '研究档案',
      icon: 'lucide:messages-square',
      order: 5.5,
    },
  },
  {
    name: 'HciConsumerReport', path: '/consumer-insights/reports/:id',
    component: () => import('#/views/intelligence/consumer-report.vue'),
    meta: { title: '消费者洞察报告', hideInMenu: true, activePath: '/consumer-insights' },
  },
  {
    name: 'HciAiConfig', path: '/ai-config',
    component: () => import('#/views/intelligence/ai-config.vue'),
    meta: { title: 'AI 配置', icon: 'lucide:bot', order: 12.5, authority: ['super'] },
  },
  {
    name: 'HciSignals',
    path: '/signals',
    component: () => import('#/views/intelligence/signals.vue'),
    meta: { title: '公共情报源', icon: 'lucide:database-zap', order: 7 },
  },
  {
    name: 'HciOpportunities',
    path: '/opportunities',
    component: () => import('#/views/intelligence/opportunities.vue'),
    meta: { title: '机会研究', icon: 'lucide:lightbulb', order: 8 },
  },
  {
    name: 'HciReviews',
    path: '/reviews',
    component: () => import('#/views/intelligence/reviews.vue'),
    meta: { title: '人工审核', icon: 'lucide:clipboard-check', order: 9 },
  },
  {
    name: 'HciImports',
    path: '/imports',
    component: () => import('#/views/intelligence/imports.vue'),
    meta: { title: '数据导入', icon: 'lucide:upload', order: 10 },
  },
  {
    name: 'HciMonitor',
    path: '/monitor',
    component: () => import('#/views/intelligence/monitor.vue'),
    meta: { title: '监控与任务', icon: 'lucide:activity', order: 11 },
  },
  {
    name: 'HciSettings',
    path: '/settings',
    component: () => import('#/views/intelligence/settings.vue'),
    meta: {
      title: '设置',
      icon: 'lucide:settings-2',
      order: 12,
      authority: ['super'],
    },
  },
  {
    name: 'HciCodeReleases',
    path: '/releases',
    component: () => import('#/views/intelligence/releases.vue'),
    meta: {
      title: '代码提交日志',
      icon: 'lucide:git-commit-horizontal',
      order: 14,
      authority: ['super'],
    },
  },
  { name: 'HciProductResearch', path: '/product-research', component: () => import('#/views/intelligence/product-research.vue'), meta: { title: '商品研究', hideInMenu: true } },
  { name: 'HciSourceUsage', path: '/usage', component: () => import('#/views/intelligence/usage.vue'), meta: { title: '资源消耗', authority: ['super'] } },
  ...(import.meta.env.VITE_HCI_SERVER === 'true'
    ? [
        {
          name: 'HciAdministration',
          path: '/administration',
          component: () => import('#/views/intelligence/administration.vue'),
          meta: { title: '账号与管理', icon: 'lucide:users-round', order: 13 },
        },
      ]
    : []),
];
export default routes;
