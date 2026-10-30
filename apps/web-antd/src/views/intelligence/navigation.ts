export interface WorkspaceLink { title: string; path: string; icon?: string; admin?: boolean; }
export const workspaceSections: { title?: string; links: WorkspaceLink[] }[] = [
  { links: [
    { title: '工作台', path: '/overview', icon: 'lucide:layout-dashboard' },
    { title: '找方向', path: '/radar', icon: 'lucide:telescope' },
    { title: '研究档案', path: '/consumer-insights', icon: 'lucide:folder-open' },
    { title: '关键词', path: '/research', icon: 'lucide:trending-up' },
  ] },
  { title: '证据库', links: [
    { title: '商品库', path: '/products', icon: 'lucide:package-search' },
    { title: '独立站', path: '/sites', icon: 'lucide:globe' },
    { title: '广告', path: '/ads', icon: 'lucide:megaphone' },
    { title: '内容与公共情报', path: '/signals', icon: 'lucide:book-open' },
  ] },
  { title: '运行中心', links: [
    { title: '监控与任务', path: '/monitor', icon: 'lucide:activity' },
    { title: '资源消耗', path: '/usage', icon: 'lucide:chart-no-axes-combined', admin: true },
    { title: '设置', path: '/settings', icon: 'lucide:settings-2', admin: true },
  ] },
];
export function workspaceActivePath(path: string, _tab?: unknown) {
  if (['/research', '/selected-keywords', '/trends'].includes(path)) return '/research';
  if (['/radar', '/opportunities', '/ingredient-research'].includes(path)) return '/radar';
  if (path.startsWith('/consumer-insights') || path === '/product-research') return '/consumer-insights';
  if (path === '/reviews') return '/overview';
  if (path === '/monitor') return '/monitor';
  if (['/ads', '/advertisers', '/ad-reports'].includes(path)) return '/ads';
  if (['/settings', '/ai-config', '/administration', '/imports', '/releases', '/workspace-settings'].includes(path)) return '/settings';
  return path;
}
export function workspaceTabs(path: string, admin: boolean): WorkspaceLink[] {
  const active = workspaceActivePath(path);
  if (active === '/research') return [{ title: '全部关键词', path: '/research' }, { title: '已入选', path: '/selected-keywords' }, { title: '趋势对比', path: '/trends' }];
  if (active === '/radar') return [{ title: '新品雷达', path: '/radar' }, { title: '机会研究', path: '/opportunities' }, { title: '成分研究', path: '/ingredient-research' }];
  if (active === '/overview') return [{ title: '情报总览', path: '/overview' }, { title: '全局待审核', path: '/reviews' }];
  if (active === '/consumer-insights') return [{ title: '研究与报告', path: '/consumer-insights' }, { title: '商品研究', path: '/product-research' }];
  if (active === '/ads') return [{ title: '广告素材', path: '/ads' }, { title: '广告主', path: '/advertisers' }, { title: '广告分析报告', path: '/ad-reports' }];
  if (active === '/settings') return [
    ...(admin ? [{ title: '数据源连接', path: '/settings' }, { title: 'AI 配置', path: '/ai-config' }] : []),
    { title: '账号与管理', path: '/administration' }, { title: '数据导入', path: '/imports' },
    ...(admin ? [{ title: '代码日志', path: '/releases' }] : []),
    ...(admin ? [{ title: '工作区', path: '/workspace-settings' }] : []),
  ];
  return [];
}
