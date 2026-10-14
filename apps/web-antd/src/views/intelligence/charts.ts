import type { Keyword } from './data';
export function trendOption(keyword: Keyword, days = 90) {
  const series = keyword.series.slice(-days);
  const observedAt = keyword.updatedAt
    ? new Date(keyword.updatedAt)
    : new Date();
  const isCollected = keyword.dataNature === 'collected';
  return {
    color: ['#198771'],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) =>
        `${value}（${isCollected ? 'Google Trends相对热度' : '演示相对指数'}）`,
    },
    grid: { left: 38, right: 15, top: 25, bottom: 30 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: series.map((_, i) => {
        const d = new Date(observedAt);
        d.setUTCDate(d.getUTCDate() - series.length + i + 1);
        return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      }),
      axisLabel: {
        color: '#87939c',
        interval: Math.max(1, Math.floor(days / 6)),
      },
      axisLine: { lineStyle: { color: '#e6ebee' } },
    },
    yAxis: {
      type: 'value',
      max: 100,
      min: 0,
      axisLabel: { color: '#87939c' },
      splitLine: { lineStyle: { color: '#e9eef1', type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        data: series,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2.5 },
        areaStyle: { color: '#198771', opacity: 0.075 },
      },
    ],
  };
}
