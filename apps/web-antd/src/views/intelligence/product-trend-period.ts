export function adjacentTrendPeriods(
  previous: string,
  current: string,
  period: 'day' | 'month',
) {
  if (period === 'month') {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(previous) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(current)
    )
      return false;
    const index = (date: string) =>
      Number(date.slice(0, 4)) * 12 + Number(date.slice(5));
    return index(current) - index(previous) === 1;
  }
  return Date.parse(current) - Date.parse(previous) === 86_400_000;
}
