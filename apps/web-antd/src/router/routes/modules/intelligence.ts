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
    meta: { title: '关键词研究', icon: 'lucide:scan-search', order: 1 },
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
    meta: { title: '数据源与设置', icon: 'lucide:settings-2', order: 12 },
  },
];
export default routes;
