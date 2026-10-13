/** RFC4180-style parser supporting commas, quoted newlines and escaped quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((s) => s.trim())) records.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV引号未闭合，请检查文件格式');
  if (cell || row.length) {
    row.push(cell);
    records.push(row);
  }
  const headers = records.shift()?.map((x) => x.trim()) || [];
  if (
    !headers.length ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new Error('表头不能为空或重复');
  return records.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(`第${i + 2}行列数与表头不符`);
    return Object.fromEntries(headers.map((h, j) => [h, r[j] || '']));
  });
}
