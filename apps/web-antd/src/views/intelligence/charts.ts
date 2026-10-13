import type { Keyword } from './data';
export function trendOption(keyword: Keyword, days = 90) {
  const series = keyword.series.slice(-days);
  return {
    color: ['#198771'],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => `${value}（演示相对指数）`,
    },
    grid: { left: 38, right: 15, top: 25, bottom: 30 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: series.map((_, i) => {
        const d = new Date(Date.UTC(2026, 9, 13));
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
