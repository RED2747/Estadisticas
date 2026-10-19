export type DataSet = { headers: string[]; rows: string[][] };
export type Frequency = { label: string; count: number; percent: number; cumulative: number };
export type Comparison = { groups: string[]; rows: Array<Record<string, string | number>> };

export const numberFrom = (value: string) => {
  let clean = value.trim().replace(/\s/g, '');
  if (!clean) return null;
  const comma = clean.lastIndexOf(',');
  const dot = clean.lastIndexOf('.');
  if (comma !== -1 && dot !== -1) {
    // The rightmost separator is treated as the decimal separator. This accepts 1.234,5 and 1,234.5.
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    clean = clean.replace(thousands, '').replace(decimal, '.');
  } else if (comma !== -1) {
    clean = clean.replace(',', '.');
  }
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
};

export const isNumericColumn = (data: DataSet, index: number) => {
  const values = data.rows.map(row => row[index] ?? '').filter(value => value.trim() !== '');
  return values.length > 0 && values.every(value => numberFrom(value) !== null);
};

const quantile = (values: number[], p: number) => {
  if (values.length === 1) return values[0];
  const position = (values.length - 1) * p;
  const base = Math.floor(position);
  const remainder = position - base;
  return values[base + 1] === undefined ? values[base] : values[base] + remainder * (values[base + 1] - values[base]);
};

export type NumericSummary = {
  n: number; sum: number; mean: number; median: number; mode: string; min: number; max: number;
  range: number; q1: number; q3: number; variancePopulation: number; standardDeviationPopulation: number;
  varianceSample: number | null; standardDeviationSample: number | null;
};

export const numericSummary = (data: DataSet, index: number): NumericSummary | null => {
  const values = data.rows.map(row => numberFrom(row[index] ?? '')).filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!values.length) return null;
  const n = values.length;
  const sum = values.reduce((total, value) => total + value, 0);
  const mean = sum / n;
  const counts = new Map<number, number>();
  values.forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  const highest = Math.max(...counts.values());
  const modes = highest === 1 ? [] : [...counts.entries()].filter(([, count]) => count === highest).map(([value]) => value);
  const variancePopulation = values.reduce((total, value) => total + (value - mean) ** 2, 0) / n;
  const varianceSample = n > 1 ? (variancePopulation * n) / (n - 1) : null;
  return {
    n, sum, mean, median: quantile(values, .5), mode: modes.length ? modes.join(', ') : 'Sin moda',
    min: values[0], max: values[n - 1], range: values[n - 1] - values[0], q1: quantile(values, .25), q3: quantile(values, .75),
    variancePopulation, standardDeviationPopulation: Math.sqrt(variancePopulation), varianceSample,
    standardDeviationSample: varianceSample === null ? null : Math.sqrt(varianceSample),
  };
};

export const frequencies = (data: DataSet, index: number): Frequency[] => {
  const values = data.rows.map(row => (row[index] ?? '').trim()).filter(Boolean);
  const total = values.length;
  const grouped = new Map<string, number>();
  values.forEach(value => grouped.set(value, (grouped.get(value) ?? 0) + 1));
  let cumulative = 0;
  return [...grouped.entries()]
    .sort(([a], [b]) => isNumericColumn(data, index) ? (numberFrom(a) ?? 0) - (numberFrom(b) ?? 0) : a.localeCompare(b, 'es'))
    .map(([label, count]) => {
      cumulative += count;
      return { label, count, percent: total ? (count / total) * 100 : 0, cumulative };
    });
};

export const histogram = (data: DataSet, index: number) => {
  const values = data.rows.map(row => numberFrom(row[index] ?? '')).filter((value): value is number => value !== null);
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const bins = Math.max(1, Math.min(10, Math.ceil(Math.sqrt(values.length))));
  const width = max === min ? 1 : (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach(value => {
    const position = max === min ? 0 : Math.min(bins - 1, Math.floor((value - min) / width));
    counts[position] += 1;
  });
  const format = (value: number) => new Intl.NumberFormat('es-DO', { maximumFractionDigits: 2 }).format(value);
  return counts.map((count, index) => {
    const start = min + index * width;
    const end = index === bins - 1 ? max : min + (index + 1) * width;
    return { label: `${format(start)}–${format(end)}`, count };
  });
};

export const scatterPoints = (data: DataSet, xIndex: number, yIndex: number) => data.rows
  .map(row => ({ x: numberFrom(row[xIndex] ?? ''), y: numberFrom(row[yIndex] ?? '') }))
  .filter((point): point is { x: number; y: number } => point.x !== null && point.y !== null);

export const comparison = (data: DataSet, categoryIndex: number, groupIndex: number): Comparison => {
  const values = new Map<string, Map<string, number>>();
  const groups = new Set<string>();
  data.rows.forEach(row => {
    const category = (row[categoryIndex] ?? '').trim();
    const group = (row[groupIndex] ?? '').trim();
    if (!category || !group) return;
    groups.add(group);
    const counts = values.get(category) ?? new Map<string, number>();
    counts.set(group, (counts.get(group) ?? 0) + 1);
    values.set(category, counts);
  });
  const groupList = [...groups].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    groups: groupList,
    rows: [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([category, counts]) => ({ category, ...Object.fromEntries(groupList.map(group => [group, counts.get(group) ?? 0])) })),
  };
};

export const nonNumericValues = (data: DataSet, index: number) => data.rows
  .map((row, rowIndex) => ({ row: rowIndex + 1, value: (row[index] ?? '').trim() }))
  .filter(item => item.value && numberFrom(item.value) === null);

export const missingValues = (data: DataSet) => data.headers.map((header, column) => ({
  header, count: data.rows.filter(row => !(row[column] ?? '').trim()).length,
}));

export const parseDelimitedText = (text: string): DataSet => {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const separator = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const parseLine = (line: string) => {
    const fields: string[] = []; let cell = ''; let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === separator && !quoted) { fields.push(cell.trim()); cell = ''; }
      else cell += char;
    }
    fields.push(cell.trim()); return fields;
  };
  const all = lines.map(parseLine);
  const width = Math.max(...all.map(row => row.length));
  const headers = all[0].map((header, index) => header || `Columna ${index + 1}`);
  while (headers.length < width) headers.push(`Columna ${headers.length + 1}`);
  return { headers, rows: all.slice(1).map(row => Array.from({ length: width }, (_, index) => row[index] ?? '')) };
};
