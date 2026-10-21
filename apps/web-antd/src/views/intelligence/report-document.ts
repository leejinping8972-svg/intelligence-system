import type { ResearchEvidence, ResearchReport } from './research-reports';

export const reportSections: Record<string, string> = {
  audience: '人群与购买动机',
  creative: '创意与说服链',
  positioning: '品牌与定位对比',
  offer: '商品与优惠',
  opportunity: '差异化机会',
  test: '优先测试计划',
};
export type ReportBlock = {
  kind: 'title' | 'heading' | 'subheading' | 'text' | 'link';
  text: string;
  url?: string;
  appendix?: boolean;
};
const safeUrl = (value?: string) => {
  try {
    const u = new URL(value || '');
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
};
export const reportStatus = (value: string) =>
  ({
    queued: '排队中',
    running: '生成中',
    completed: '已完成',
    partial: '部分完成',
    cancelled: '已取消',
  })[value] || value;
export function reportDocument(
  report: ResearchReport,
  evidence: ResearchEvidence[],
): ReportBlock[] {
  const blocks: ReportBlock[] = [],
    model = report.modelAnalysis;
  const add = (kind: ReportBlock['kind'], text: string, appendix = false) =>
    blocks.push({ kind, text, appendix });
  const link = (label: string, url?: string, appendix = false) => {
    const safe = safeUrl(url);
    if (safe) blocks.push({ kind: 'link', text: label, url: safe, appendix });
  };
  const refs = new Map(
    evidence.map((e, i) => [e.id, `E${String(i + 1).padStart(3, '0')}`]),
  );
  const cite = (ids: string[]) =>
    ids
      .map((id) => refs.get(id))
      .filter(Boolean)
      .join('、') || '未匹配到证据';
  add('title', report.title);
  add(
    'text',
    `研究市场 ${report.market}    创建时间 ${new Date(report.createdAt).toLocaleString('zh-CN')}    状态 ${reportStatus(report.status)}`,
  );
  add('heading', '决策摘要');
  add(
    'text',
    model?.summary ||
      (report.modelError
        ? `模型分析未完成：${report.modelError}`
        : '本报告包含原始证据与规则统计，尚未生成模型策略分析。规则主题不能替代研究结论。'),
  );
  if (report.researchFocus)
    add('text', `本次研究重点：${report.researchFocus}`);
  if (report.reportType === 'market' && report.marketSnapshot) {
    const snapshot = report.marketSnapshot;
    add('heading', '市场覆盖与冻结口径');
    add(
      'text',
      `统计窗口 ${snapshot.startAt.slice(0, 10)} 至 ${snapshot.endAt.slice(0, 10)}；快照冻结时间 ${new Date(snapshot.frozenAt).toLocaleString('zh-CN')}。`,
    );
    add(
      'text',
      `商品 ${snapshot.coverage.products} 件（TikTok Shop ${snapshot.coverage.tiktokShopProducts} 件、独立站 ${snapshot.coverage.independentSiteProducts} 件）；Meta在投广告 ${snapshot.coverage.activeMetaAds} 条；独立站 ${snapshot.coverage.independentSites} 家；TikTok内容 ${snapshot.coverage.tiktokContent} 条；消费者评论 ${snapshot.coverage.consumerComments} 条。`,
    );
    add('heading', '高信号商品与配方');
    for (const item of snapshot.topProducts.slice(0, 20))
      add(
        'text',
        `${item.title}｜${item.brand || '品牌未记录'}｜${item.source}｜平台展示销量 ${item.reportedSales}｜评论 ${item.reviewCount}｜评分 ${item.rating || '未记录'}`,
      );
    if (snapshot.topIngredients.length > 0)
      add(
        'text',
        `常见配方信号：${snapshot.topIngredients
          .slice(0, 15)
          .map((item) => `${item.name}（${item.count}件）`)
          .join('、')}。`,
      );
    if (snapshot.topAdvertisers.length > 0) {
      add('heading', 'Meta在投广告主');
      for (const item of snapshot.topAdvertisers.slice(0, 15))
        add(
          'text',
          `${item.name}：${item.ads}条在投广告，关联${item.landingSites}个落地站。`,
        );
    }
  }
  add('heading', '研究范围与数据来源');
  const brands = [...new Set(evidence.map((e) => e.brand).filter(Boolean))];
  add(
    'text',
    `保存证据 ${evidence.length} 条；品牌 ${brands.length} 个；原始页面 ${new Set(evidence.map((e) => e.url).filter(Boolean)).size} 个。${report.parentReportId ? '本次复用已有报告证据，没有重新搜索广告或转写视频。' : ''}`,
  );
  const providers = [
    ...new Set(evidence.map((e) => e.collectionSource).filter(Boolean)),
  ];
  const platforms = [
    ...new Set(evidence.map((e) => e.platform).filter(Boolean)),
  ];
  add(
    'text',
    `原始平台：${platforms.join('、') || '未记录'}；采集渠道：${providers.join('、') || '历史记录未保存渠道详情，请以证据原始链接为准'}。`,
  );
  if (report.kind === 'ad_analysis' || report.reportType === 'ad')
    add(
      'text',
      '输入为广告标题、文案、已取得的视频转写和已记录的品牌、状态、时间及落地链接。落地链接只是来源信息，未读取页面正文；没有输入视频画面、消费者评论、Semrush指标、广告花费、成交或ROAS数据。广告主宣称不等于经过验证的科学证据。',
    );
  if (model) {
    add(
      'text',
      `分析模型 ${model.model}；模型处理 ${model.inputEvidenceCount} / ${model.totalEvidenceCount} 条；服务商返回 tokens ${model.usage?.total_tokens ?? '未知'}。`,
    );
    const c = model.coverage;
    if (c)
      add(
        'text',
        `去重创意 ${c.uniqueCreativeCount} 条；分析覆盖 ${c.brandCount} 个品牌、${c.transcriptCount} 条带转写证据；文本截断 ${c.truncatedCount} 条；未纳入模型 ${c.omittedCount} 条。${c.method}。完整原文见附录。`,
      );
    const groups =
      model.schemaVersion === 2
        ? Object.entries(reportSections)
        : [['legacy', '策略解读']];
    for (const [section, label] of groups) {
      const findings = model.findings.filter(
        (f) => model.schemaVersion !== 2 || f.section === section,
      );
      if (!findings.length) continue;
      add('heading', label!);
      for (const f of findings) {
        add('subheading', f.label);
        if (f.observation) add('text', `观察事实：${f.observation}`);
        add('text', `分析推断：${f.interpretation}`);
        add('text', `建议行动：${f.suggestion}`);
        add(
          'text',
          `证据 ${cite(f.evidenceIds)}${f.confidence ? `；置信度 ${f.confidence}` : ''}`,
        );
        for (const quote of f.quotes || [])
          add('text', `${cite([quote.evidenceId])} 原文：“${quote.text}”`);
        if (f.test)
          for (const [key, name] of Object.entries({
            priority: '优先级',
            hypothesis: '测试假设',
            constant: '保持不变',
            control: '对照表达',
            variant: '备选表达',
            metric: '主要指标',
            decisionRule: '判断方法',
          }))
            add('text', `${name}：${f.test[key as keyof typeof f.test]}`);
      }
    }
  }
  if (brands.length) {
    add('heading', '品牌样本概览');
    for (const brand of brands) {
      const rows = evidence.filter((e) => e.brand === brand);
      add('subheading', String(brand));
      add(
        'text',
        `${rows.length} 条证据，${rows.filter((e) => e.transcript).length} 条已有转写。${cite(rows.map((e) => e.id))}`,
      );
      const landing = [
        ...new Set(rows.map((e) => safeUrl(e.landingUrl)).filter(Boolean)),
      ];
      for (const url of landing) link('已记录落地链接', url);
    }
  }
  add(
    'heading',
    report.reportType === 'market'
      ? '统计方法与研究局限'
      : '主题统计与研究局限',
  );
  add(
    'text',
    `${report.statistics?.method || '暂无规则统计'}。主题可能重叠，计数是本次样本命中数，不能推算市场份额。`,
  );
  for (const theme of report.statistics?.themes || [])
    add(
      'text',
      `${theme.label}：${theme.count} 条（${cite(theme.evidenceIds)}）。`,
    );
  for (const text of [
    ...new Set([
      ...(model?.limitations || []),
      ...(report.statistics?.limitations || []),
    ]),
  ])
    add('text', text);
  add(
    'text',
    `人工审阅：${report.reviewStatus === 'selected' ? '入选' : report.reviewStatus === 'excluded' ? '排除' : '待审阅'}${report.reviewNote ? `；${report.reviewNote}` : ''}`,
  );
  add('heading', '完整证据附录', true);
  for (const e of evidence) {
    add(
      'subheading',
      `${refs.get(e.id)} ${e.brand || e.platform || '来源未记录'}`,
      true,
    );
    add(
      'text',
      `证据类型 ${e.kind === 'advertiser_claim' ? '广告主宣称' : e.kind}；平台 ${e.platform || '未记录'}；采集 ${e.collectedAt || '未记录'}；广告开始 ${e.startDate || '未记录'}；状态 ${e.status || '未记录'}。`,
      true,
    );
    link('原始来源', e.url, true);
    link('已记录落地链接', e.landingUrl, true);
    add('text', e.text || '无可用原文', true);
    add('text', `原始证据编号 ${e.id}`, true);
  }
  add('heading', '生成配置与提示词记录', true);
  const prompt = model?.prompt || report.prompt;
  add(
    'text',
    `报告编号 ${report.id}；提示词版本 ${prompt?.version || '历史报告未记录'}。`,
    true,
  );
  if (prompt)
    add(
      'text',
      model?.systemPrompt ||
        `${prompt.text}${prompt.systemContract ? `\n${prompt.systemContract}` : ''}`,
      true,
    );
  else
    add(
      'text',
      '此历史报告没有保留实际使用提示词的快照，不用当前提示词冒充历史配置。',
      true,
    );
  return blocks;
}
export function reportFilename(report: ResearchReport, extension: string) {
  return `${report.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 70) || '研究报告'}-${report.id.slice(0, 8)}.${extension}`;
}
