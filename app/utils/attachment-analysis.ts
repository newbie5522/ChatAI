import "server-only";

import * as XLSX from "xlsx";

export interface DocumentChunk {
  index: number;
  start: number;
  end: number;
  text: string;
  headingHint?: string;
  searchableText: string;
}

export type TableCell = string | number | boolean | Date | null;

export interface TableSheetData {
  name: string;
  columns: string[];
  rows: TableCell[][];
}

export interface TableColumnProfile {
  name: string;
  type: "number" | "date" | "text" | "boolean" | "empty" | "mixed";
  nullCount: number;
  nonNullCount: number;
  uniqueCount: number;
  numeric?: {
    count: number;
    sum: number;
    average: number;
    min: number;
    max: number;
  };
  date?: { count: number; min: string; max: string };
  topValues?: Array<{ value: string; count: number }>;
}

export interface TableMetricSummary {
  spend?: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  linkClicks?: number;
  purchases?: number;
  conversionValue?: number;
  ctr?: number;
  cpc?: number;
  cpm?: number;
  cpa?: number;
  roas?: number;
}

export interface TableGroupSummary {
  dimension: string;
  value: string;
  rows: number;
  metrics: TableMetricSummary;
}

export interface TableProfile {
  rowCount: number;
  columnCount: number;
  sheetCount: number;
  duplicateRowCount: number;
  columns: TableColumnProfile[];
  metrics: TableMetricSummary;
  groups: TableGroupSummary[];
  normalizedColumns: string[];
}

const DOCUMENT_CHUNK_SIZE = 12_000;
const DOCUMENT_CHUNK_OVERLAP = 800;
const SUMMARY_TERMS = [
  "总结",
  "概括",
  "全文",
  "整体",
  "报告",
  "全部内容",
  "核心观点",
  "主要结论",
];
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

const COLUMN_ALIASES = {
  account: ["account", "accountname", "adaccount", "广告账户", "账户", "账号"],
  campaign: ["campaign", "campaignname", "广告系列", "推广系列", "计划"],
  adset: ["adset", "adsetname", "广告组", "广告组名称", "单元"],
  ad: ["ad", "adname", "广告", "广告名称", "创意"],
  date: ["date", "day", "reportingstarts", "日期", "时间", "投放日期"],
  spend: ["spend", "amountspent", "cost", "花费", "消耗", "支出"],
  impressions: ["impressions", "展示", "展示次数", "曝光", "曝光次数"],
  reach: ["reach", "覆盖", "覆盖人数"],
  clicks: ["clicks", "allclicks", "点击", "点击次数"],
  linkClicks: [
    "linkclicks",
    "outboundclicks",
    "outboundclick",
    "链接点击",
    "外链点击",
  ],
  purchases: [
    "purchases",
    "purchase",
    "results",
    "购买",
    "购买次数",
    "成效",
    "转化",
  ],
  conversionValue: [
    "purchaseconversionvalue",
    "conversionvalue",
    "revenue",
    "sales",
    "购买转化价值",
    "转化价值",
    "收入",
    "销售额",
  ],
} as const;

type AliasKey = keyof typeof COLUMN_ALIASES;

function normalizeColumn(value: string) {
  return value
    .toLowerCase()
    .replace(/[\s_.:\/(){}-]+/g, "")
    .replace(/\[|\]/g, "");
}

function displayCell(value: TableCell) {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function finiteNumber(value: TableCell) {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .replace(/[$¥￥,%\s]/g, "")
    .replace(/,/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return value.includes("%") ? parsed / 100 : parsed;
}

function dateValue(value: TableCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || !/[年/月日\-:]/.test(value))
    return undefined;
  const parsed = new Date(value.replace(/年|月/g, "-").replace(/日/g, ""));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function uniqueHeaders(values: TableCell[]) {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = displayCell(value).trim() || `列 ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

export function parseTableWorkbook(buffer: Buffer, extension: string) {
  const workbook = XLSX.read(
    extension === ".csv"
      ? new TextDecoder("utf-8", { fatal: true }).decode(buffer)
      : buffer,
    {
      type: extension === ".csv" ? "string" : "buffer",
      raw: true,
      cellDates: true,
      dense: false,
    },
  );
  if (workbook.SheetNames.length > 100) {
    throw new Error("工作表数量超过当前分析上限，请拆分文件后重新上传。");
  }

  let totalRows = 0;
  const sheets = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const range = sheet["!ref"]
      ? XLSX.utils.decode_range(sheet["!ref"])
      : undefined;
    const estimatedRows = range ? range.e.r - range.s.r : 0;
    const estimatedColumns = range ? range.e.c - range.s.c + 1 : 0;
    if (estimatedRows > 200_000 || estimatedColumns > 300) {
      throw new Error(
        "数据行数超过当前分析上限，请按日期、广告账户或月份拆分文件。",
      );
    }
    const matrix = XLSX.utils.sheet_to_json<TableCell[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    if (matrix.length === 0) return { name, columns: [], rows: [] };
    const columns = uniqueHeaders(matrix[0]);
    const rows = matrix
      .slice(1)
      .map((row) => columns.map((_, index) => row[index] ?? null));
    if (rows.length > 200_000) {
      throw new Error(
        "数据行数超过当前分析上限，请按日期、广告账户或月份拆分文件。",
      );
    }
    totalRows += rows.length;
    if (totalRows > 300_000) {
      throw new Error(
        "数据行数超过当前分析上限，请按日期、广告账户或月份拆分文件。",
      );
    }
    return { name, columns, rows };
  });

  return sheets;
}

function findColumn(columns: string[], key: AliasKey) {
  const aliases = new Set(COLUMN_ALIASES[key].map(normalizeColumn));
  const index = columns.findIndex((column) =>
    aliases.has(normalizeColumn(column)),
  );
  return index >= 0 ? index : undefined;
}

function addMetricValue(
  metrics: TableMetricSummary,
  key: AliasKey,
  value: number,
) {
  if (key === "spend") metrics.spend = (metrics.spend ?? 0) + value;
  if (key === "impressions")
    metrics.impressions = (metrics.impressions ?? 0) + value;
  if (key === "reach") metrics.reach = (metrics.reach ?? 0) + value;
  if (key === "clicks") metrics.clicks = (metrics.clicks ?? 0) + value;
  if (key === "linkClicks")
    metrics.linkClicks = (metrics.linkClicks ?? 0) + value;
  if (key === "purchases") metrics.purchases = (metrics.purchases ?? 0) + value;
  if (key === "conversionValue") {
    metrics.conversionValue = (metrics.conversionValue ?? 0) + value;
  }
}

function finishMetrics(metrics: TableMetricSummary) {
  const clicks = metrics.linkClicks ?? metrics.clicks;
  if (metrics.impressions && clicks !== undefined)
    metrics.ctr = clicks / metrics.impressions;
  if (clicks && metrics.spend !== undefined)
    metrics.cpc = metrics.spend / clicks;
  if (metrics.impressions && metrics.spend !== undefined) {
    metrics.cpm = (metrics.spend * 1000) / metrics.impressions;
  }
  if (metrics.purchases && metrics.spend !== undefined) {
    metrics.cpa = metrics.spend / metrics.purchases;
  }
  if (metrics.spend && metrics.conversionValue !== undefined) {
    metrics.roas = metrics.conversionValue / metrics.spend;
  }
  return metrics;
}

function metricsForRows(sheet: TableSheetData, rows: TableCell[][]) {
  const metrics: TableMetricSummary = {};
  const keys: AliasKey[] = [
    "spend",
    "impressions",
    "reach",
    "clicks",
    "linkClicks",
    "purchases",
    "conversionValue",
  ];
  keys.forEach((key) => {
    const index = findColumn(sheet.columns, key);
    if (index === undefined) return;
    rows.forEach((row) => {
      const value = finiteNumber(row[index]);
      if (value !== undefined) addMetricValue(metrics, key, value);
    });
  });
  return finishMetrics(metrics);
}

function profileColumn(name: string, values: TableCell[]): TableColumnProfile {
  const nonNull = values.filter(
    (value) => value !== null && displayCell(value).trim() !== "",
  );
  const numbers = nonNull
    .map(finiteNumber)
    .filter((value): value is number => value !== undefined);
  const dates = nonNull
    .map(dateValue)
    .filter((value): value is Date => value !== undefined);
  const booleans = nonNull.filter((value) => typeof value === "boolean");
  const textValues = nonNull.map(displayCell);
  const unique = new Set(textValues);
  let type: TableColumnProfile["type"] = "mixed";
  if (nonNull.length === 0) type = "empty";
  else if (numbers.length === nonNull.length) type = "number";
  else if (dates.length === nonNull.length) type = "date";
  else if (booleans.length === nonNull.length) type = "boolean";
  else if (numbers.length === 0 && dates.length === 0 && booleans.length === 0)
    type = "text";

  const profile: TableColumnProfile = {
    name,
    type,
    nullCount: values.length - nonNull.length,
    nonNullCount: nonNull.length,
    uniqueCount: unique.size,
  };
  if (numbers.length) {
    const sum = numbers.reduce((total, value) => total + value, 0);
    const minimum = numbers.reduce(
      (current, value) => Math.min(current, value),
      numbers[0],
    );
    const maximum = numbers.reduce(
      (current, value) => Math.max(current, value),
      numbers[0],
    );
    profile.numeric = {
      count: numbers.length,
      sum,
      average: sum / numbers.length,
      min: minimum,
      max: maximum,
    };
  }
  if (dates.length) {
    const timestamps = dates.map((date) => date.getTime());
    const minimum = timestamps.reduce(
      (current, value) => Math.min(current, value),
      timestamps[0],
    );
    const maximum = timestamps.reduce(
      (current, value) => Math.max(current, value),
      timestamps[0],
    );
    profile.date = {
      count: dates.length,
      min: new Date(minimum).toISOString(),
      max: new Date(maximum).toISOString(),
    };
  }
  if (type === "text" || type === "mixed") {
    const counts = new Map<string, number>();
    textValues.forEach((value) =>
      counts.set(value, (counts.get(value) ?? 0) + 1),
    );
    profile.topValues = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 20)
      .map(([value, count]) => ({ value, count }));
  }
  return profile;
}

export function buildTableProfile(sheets: TableSheetData[]): TableProfile {
  const allColumns = [...new Set(sheets.flatMap((sheet) => sheet.columns))];
  const valuesByColumn = new Map<string, TableCell[]>();
  allColumns.forEach((column) => valuesByColumn.set(column, []));
  const rowKeys = new Set<string>();
  let duplicateRowCount = 0;
  const metrics: TableMetricSummary = {};
  const groups: TableGroupSummary[] = [];

  sheets.forEach((sheet) => {
    sheet.rows.forEach((row) => {
      const key = JSON.stringify(row.map(displayCell));
      if (rowKeys.has(key)) duplicateRowCount += 1;
      else rowKeys.add(key);
    });
    allColumns.forEach((column) => {
      const index = sheet.columns.indexOf(column);
      const target = valuesByColumn.get(column);
      if (!target) return;
      sheet.rows.forEach((row) =>
        target.push(index >= 0 ? row[index] ?? null : null),
      );
    });
    const sheetMetrics = metricsForRows(sheet, sheet.rows);
    (
      [
        "spend",
        "impressions",
        "reach",
        "clicks",
        "linkClicks",
        "purchases",
        "conversionValue",
      ] as const
    ).forEach((key) => {
      const value = sheetMetrics[key];
      if (value !== undefined) metrics[key] = (metrics[key] ?? 0) + value;
    });

    (["account", "campaign", "adset", "ad", "date"] as AliasKey[]).forEach(
      (dimension) => {
        const index = findColumn(sheet.columns, dimension);
        if (index === undefined) return;
        const grouped = new Map<string, TableCell[][]>();
        sheet.rows.forEach((row) => {
          const value = displayCell(row[index]).trim();
          if (!value) return;
          const existing = grouped.get(value);
          if (existing) existing.push(row);
          else grouped.set(value, [row]);
        });
        [...grouped.entries()].forEach(([value, rows]) => {
          groups.push({
            dimension,
            value,
            rows: rows.length,
            metrics: metricsForRows(sheet, rows),
          });
        });
      },
    );
  });

  finishMetrics(metrics);
  const prioritizedGroups = groups
    .sort((left, right) => {
      const spendDifference =
        (right.metrics.spend ?? 0) - (left.metrics.spend ?? 0);
      if (spendDifference) return spendDifference;
      return (right.metrics.purchases ?? 0) - (left.metrics.purchases ?? 0);
    })
    .slice(0, 100);
  return {
    rowCount: sheets.reduce((total, sheet) => total + sheet.rows.length, 0),
    columnCount: allColumns.length,
    sheetCount: sheets.length,
    duplicateRowCount,
    columns: allColumns.map((column) =>
      profileColumn(column, valuesByColumn.get(column) ?? []),
    ),
    metrics,
    groups: prioritizedGroups,
    normalizedColumns: allColumns.map(normalizeColumn),
  };
}

export function estimateTableBytes(sheets: TableSheetData[]) {
  return sheets.reduce<number>(
    (total, sheet) =>
      total +
      sheet.name.length * 2 +
      sheet.columns.reduce<number>(
        (sum, column) => sum + column.length * 2,
        0,
      ) +
      sheet.rows.reduce<number>(
        (rowTotal, row) =>
          rowTotal +
          row.reduce<number>(
            (cellTotal, cell) =>
              cellTotal +
              (cell === null ? 4 : displayCell(cell).length * 2 + 8),
            0,
          ),
        0,
      ),
    0,
  );
}

function headingBefore(text: string, start: number) {
  const preceding = text
    .slice(Math.max(0, start - 1000), start)
    .split(/\r?\n/)
    .reverse();
  return preceding
    .find((line) =>
      /^\s*(?:#{1,6}\s+|第.+[章节篇]|[一二三四五六七八九十]+[、.])/.test(line),
    )
    ?.trim();
}

export function tokenizeSearchText(text: string) {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();
  lower.match(/[a-z][a-z0-9._-]*|\d+(?:[.,:/-]\d+)*/g)?.forEach((token) => {
    if (!STOP_WORDS.has(token)) tokens.add(token);
  });
  lower.match(/[\u3400-\u9fff]+/g)?.forEach((sequence) => {
    if (sequence.length <= 3) tokens.add(sequence);
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= sequence.length - size; index += 1) {
        tokens.add(sequence.slice(index, index + size));
      }
    }
  });
  return [...tokens].join(" ");
}

export function buildDocumentChunks(text: string) {
  const chunks: DocumentChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + DOCUMENT_CHUNK_SIZE);
    if (end < text.length) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > start + DOCUMENT_CHUNK_SIZE / 2) end = boundary;
    }
    const chunkText = text.slice(start, end).trim();
    const headingHint = headingBefore(text, start);
    chunks.push({
      index: chunks.length,
      start,
      end,
      text: chunkText,
      headingHint,
      searchableText: tokenizeSearchText(`${headingHint ?? ""}\n${chunkText}`),
    });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - DOCUMENT_CHUNK_OVERLAP);
  }
  return chunks;
}

export function selectDocumentChunks(chunks: DocumentChunk[], query: string) {
  if (chunks.length <= 8) return chunks;
  const summary = SUMMARY_TERMS.some((term) => query.includes(term));
  if (summary) {
    const indexes = new Set<number>([0, chunks.length - 1]);
    chunks.forEach((chunk) => {
      if (chunk.headingHint) indexes.add(chunk.index);
    });
    const remaining = Math.max(0, 16 - indexes.size);
    for (let offset = 1; offset <= remaining; offset += 1) {
      indexes.add(Math.round((offset * (chunks.length - 1)) / (remaining + 1)));
    }
    return [...indexes]
      .sort((left, right) => left - right)
      .slice(0, 16)
      .map((index) => chunks[index]);
  }
  const queryTokens = new Set(
    tokenizeSearchText(query).split(" ").filter(Boolean),
  );
  const ranked = chunks
    .map((chunk) => ({
      chunk,
      score: chunk.searchableText
        .split(" ")
        .reduce((score, token) => score + Number(queryTokens.has(token)), 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.chunk.index - right.chunk.index,
    )
    .slice(0, 8)
    .map(({ chunk }) => chunk);
  const selected = new Map(ranked.map((chunk) => [chunk.index, chunk]));
  selected.set(0, chunks[0]);
  const heading = chunks.find(
    (chunk) =>
      chunk.headingHint && ranked.some((item) => item.index === chunk.index),
  );
  if (heading) selected.set(heading.index, heading);
  return [...selected.values()].sort((left, right) => left.index - right.index);
}

function formatMetric(value: number | undefined, percent = false) {
  if (value === undefined || !Number.isFinite(value)) return "无数据";
  return percent
    ? `${(value * 100).toFixed(2)}%`
    : value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function metricLines(metrics: TableMetricSummary) {
  return [
    `花费: ${formatMetric(metrics.spend)}`,
    `展示: ${formatMetric(metrics.impressions)}`,
    `覆盖: ${formatMetric(metrics.reach)}`,
    `点击: ${formatMetric(metrics.clicks)}`,
    `链接/外链点击: ${formatMetric(metrics.linkClicks)}`,
    `购买/成效: ${formatMetric(metrics.purchases)}`,
    `转化价值: ${formatMetric(metrics.conversionValue)}`,
    `CTR: ${formatMetric(metrics.ctr, true)}`,
    `CPC: ${formatMetric(metrics.cpc)}`,
    `CPM: ${formatMetric(metrics.cpm)}`,
    `CPA: ${formatMetric(metrics.cpa)}`,
    `ROAS: ${formatMetric(metrics.roas)}`,
  ];
}

export function buildTableAnalysisContext(
  name: string,
  sheets: TableSheetData[],
  profile: TableProfile,
  query: string,
) {
  const terms = tokenizeSearchText(query).split(" ").filter(Boolean);
  const relevant: Array<{
    sheet: string;
    columns: string[];
    row: TableCell[];
  }> = [];
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const searchable = tokenizeSearchText(row.map(displayCell).join(" "));
      if (
        terms.length === 0 ||
        terms.some((term) => searchable.includes(term))
      ) {
        relevant.push({ sheet: sheet.name, columns: sheet.columns, row });
      }
      if (relevant.length >= 200) break;
    }
    if (relevant.length >= 200) break;
  }
  if (relevant.length === 0) {
    sheets.forEach((sheet) =>
      sheet.rows
        .slice(0, Math.max(0, 200 - relevant.length))
        .forEach((row) =>
          relevant.push({ sheet: sheet.name, columns: sheet.columns, row }),
        ),
    );
  }

  const columnLines = profile.columns.map((column) => {
    const details = column.numeric
      ? `，数值总和 ${formatMetric(column.numeric.sum)}，平均 ${formatMetric(
          column.numeric.average,
        )}，最小 ${formatMetric(column.numeric.min)}，最大 ${formatMetric(
          column.numeric.max,
        )}`
      : column.date
      ? `，日期范围 ${column.date.min} 至 ${column.date.max}`
      : column.topValues?.length
      ? `，高频值 ${column.topValues
          .slice(0, 5)
          .map((item) => `${item.value}(${item.count})`)
          .join("、")}`
      : "";
    return `- ${column.name}: ${column.type}，空值 ${column.nullCount}，唯一值 ${column.uniqueCount}${details}`;
  });
  const groupLine = (group: TableGroupSummary) =>
    `- ${group.dimension}=${group.value}: ${group.rows} 行，花费 ${formatMetric(
      group.metrics.spend,
    )}，购买 ${formatMetric(group.metrics.purchases)}，ROAS ${formatMetric(
      group.metrics.roas,
    )}`;
  const topSpend = [...profile.groups]
    .sort(
      (left, right) => (right.metrics.spend ?? 0) - (left.metrics.spend ?? 0),
    )
    .slice(0, 10)
    .map(groupLine);
  const topPurchases = [...profile.groups]
    .sort(
      (left, right) =>
        (right.metrics.purchases ?? 0) - (left.metrics.purchases ?? 0),
    )
    .slice(0, 10)
    .map(groupLine);
  const minimumRoasSpend = Math.max(1, (profile.metrics.spend ?? 0) * 0.001);
  const topRoas = profile.groups
    .filter(
      (group) =>
        (group.metrics.spend ?? 0) >= minimumRoasSpend &&
        group.metrics.roas !== undefined,
    )
    .sort((left, right) => (right.metrics.roas ?? 0) - (left.metrics.roas ?? 0))
    .slice(0, 10)
    .map(groupLine);
  const anomalies = profile.groups
    .filter(
      (group) =>
        ((group.metrics.spend ?? 0) >= minimumRoasSpend &&
          (group.metrics.purchases ?? 0) === 0) ||
        (group.metrics.ctr !== undefined && group.metrics.ctr > 0.2),
    )
    .slice(0, 10)
    .map(groupLine);
  const rowLines = relevant.map(
    ({ sheet, columns, row }) =>
      `[${sheet}] ${columns
        .map((column, index) => `${column}=${displayCell(row[index])}`)
        .join(" | ")}`,
  );
  const header = [
    `[表格分析开始]`,
    `文件名: ${name}`,
    `完整范围: ${
      profile.sheetCount
    } 个工作表，${profile.rowCount.toLocaleString("zh-CN")} 行，${
      profile.columnCount
    } 列`,
    `重复行: ${profile.duplicateRowCount.toLocaleString("zh-CN")}`,
    `全量指标:`,
    ...metricLines(profile.metrics),
    `字段画像:`,
    ...columnLines,
    `花费最高分组:`,
    ...(topSpend.length ? topSpend : ["- 无数据"]),
    `购买/成效最高分组:`,
    ...(topPurchases.length ? topPurchases : ["- 无数据"]),
    `ROAS 最高分组（最低花费阈值 ${formatMetric(minimumRoasSpend)}）:`,
    ...(topRoas.length ? topRoas : ["- 无数据"]),
    `异常线索（有花费无购买，或 CTR 显著偏高）:`,
    ...(anomalies.length ? anomalies : ["- 未发现明确异常线索"]),
    `与问题相关的记录（最多 200 行）:`,
  ].join("\n");
  const includedRows: string[] = [];
  let usedCharacters = header.length + "\n[表格分析结束]".length;
  for (const line of rowLines) {
    if (usedCharacters + line.length + 1 > 140_000) break;
    includedRows.push(line);
    usedCharacters += line.length + 1;
  }
  return {
    content: [header, ...includedRows, `[表格分析结束]`]
      .join("\n")
      .slice(0, 140_000),
    relevantRowCount: includedRows.length,
  };
}

export function buildCombinedTableSummary(
  tables: Array<{ name: string; profile: TableProfile }>,
) {
  if (tables.length < 2) return "";
  const metrics: TableMetricSummary = {};
  tables.forEach(({ profile }) => {
    (
      [
        "spend",
        "impressions",
        "reach",
        "clicks",
        "linkClicks",
        "purchases",
        "conversionValue",
      ] as const
    ).forEach((key) => {
      const value = profile.metrics[key];
      if (value !== undefined) metrics[key] = (metrics[key] ?? 0) + value;
    });
  });
  finishMetrics(metrics);
  return [
    `[多文件合并汇总]`,
    `文件数: ${tables.length}`,
    `总行数: ${tables
      .reduce((sum, table) => sum + table.profile.rowCount, 0)
      .toLocaleString("zh-CN")}`,
    ...metricLines(metrics),
    `分文件:`,
    ...tables.map(
      ({ name, profile }) =>
        `- ${name}: ${profile.rowCount.toLocaleString("zh-CN")} 行，${
          profile.sheetCount
        } 个工作表，花费 ${formatMetric(
          profile.metrics.spend,
        )}，购买 ${formatMetric(
          profile.metrics.purchases,
        )}，ROAS ${formatMetric(profile.metrics.roas)}`,
    ),
  ].join("\n");
}
