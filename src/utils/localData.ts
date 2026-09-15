import type { KeyboardLog } from '@/types';
import {
  SWITCH_TYPES,
  SOUND_CHARACTERS,
  KEYCAP_MATERIALS,
  KEYCAP_PROFILES,
  PLATE_MATERIALS,
  CASE_MATERIALS,
} from '@/types';
import { isValidCalendarDate } from './importExport';

/**
 * 本地存储数据的加载校验（与“导入文件的严格整批拒绝”相互独立）。
 *
 * 规则总览：
 * - 必填关键字段缺失 / 类型错误 / 枚举非法 / 日期不存在 / 评分越界 / 标签元素为空，
 *   都会让该条记录“残缺”，从而进入数据恢复流程，并指出第几条与具体字段；
 * - 仅“旧版本可缺失的可选字段”才允许在本地加载时补齐默认值（见 OPTIONAL_STRING_FIELDS 等），
 *   补齐只影响本次内存加载，不修改磁盘原始内容，也不改变导入文件的严格校验。
 */

export interface LocalLogIssue {
  index: number;
  field: string;
  reason: string;
}

export interface LocalLoadResult {
  ok: boolean;
  /** 通过校验（并对可选字段补齐默认值）后的记录 */
  logs: KeyboardLog[];
  issues: LocalLogIssue[];
}

const RATING_META: { key: keyof KeyboardLog; label: string }[] = [
  { key: 'overallRating', label: '整体评分' },
  { key: 'reboundRating', label: '回弹评分' },
  { key: 'tactilityRating', label: '段落评分' },
  { key: 'fatigueRating', label: '疲劳评分' },
];

const ENUM_META: { key: keyof KeyboardLog; label: string; allowed: readonly string[] }[] = [
  { key: 'switchType', label: '轴体类型', allowed: SWITCH_TYPES },
  { key: 'soundCharacter', label: '声音倾向', allowed: SOUND_CHARACTERS },
  { key: 'keycapMaterial', label: '键帽材质', allowed: KEYCAP_MATERIALS },
  { key: 'keycapProfile', label: '键帽高度', allowed: KEYCAP_PROFILES },
  { key: 'plateMaterial', label: '定位板材质', allowed: PLATE_MATERIALS },
  { key: 'caseMaterial', label: '外壳材质', allowed: CASE_MATERIALS },
];

/** 必填、且必须为非空字符串的字段 */
const REQUIRED_NONEMPTY_STRINGS: { key: keyof KeyboardLog; label: string }[] = [
  { key: 'id', label: '编号' },
  { key: 'name', label: '键盘名称' },
  { key: 'brand', label: '品牌' },
  { key: 'switchName', label: '轴体名称' },
];

/** 必填、类型必须为字符串（允许空串）的字段：型号缺失可接受，类型错误不可接受 */
const REQUIRED_STRING_PRESENT: { key: keyof KeyboardLog; label: string }[] = [
  { key: 'model', label: '型号' },
];

/**
 * 旧版本可能缺失的可选字符串字段：缺失（undefined）时补齐为 ''；
 * 若存在但类型不是字符串，则属于损坏，进入恢复流程（不静默猜测）。
 */
const OPTIONAL_STRING_FIELDS: (keyof KeyboardLog)[] = [
  'switchLubed',
  'keycapProcess',
  'plateThickness',
  'fillMaterial',
  'notes',
];

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function processOne(raw: unknown, index: number): { log: KeyboardLog | null; issues: LocalLogIssue[] } {
  const issues: LocalLogIssue[] = [];
  const at = (field: string, reason: string) => issues.push({ index, field, reason });

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    at('记录', `记录不是有效对象（实际为 ${Array.isArray(raw) ? 'array' : typeOf(raw)}）`);
    return { log: null, issues };
  }
  const o = raw as Record<string, unknown>;

  // 必填非空字符串
  for (const { key, label } of REQUIRED_NONEMPTY_STRINGS) {
    const v = o[key as string];
    if (typeof v !== 'string') {
      at(label, `${label}缺失或类型错误（应为字符串，实际为 ${typeOf(v)}）`);
    } else if (v.trim() === '') {
      at(label, `${label}为空`);
    }
  }

  // 必填字符串（允许空串，仅校验类型）
  for (const { key, label } of REQUIRED_STRING_PRESENT) {
    const v = o[key as string];
    if (typeof v !== 'string') {
      at(label, `${label}缺失或类型错误（应为字符串，实际为 ${typeOf(v)}）`);
    }
  }

  // 入手日期：必填、YYYY-MM-DD、且必须是真实存在的日历日期
  if (typeof o.purchaseDate !== 'string') {
    at('入手日期', `入手日期缺失或类型错误（应为字符串，实际为 ${typeOf(o.purchaseDate)}）`);
  } else if (!isValidCalendarDate(o.purchaseDate)) {
    at('入手日期', `入手日期不存在或格式错误（应为 YYYY-MM-DD）：${o.purchaseDate}`);
  }

  // 四个评分：必填、有限数值、1-10
  for (const { key, label } of RATING_META) {
    const v = o[key as string];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      at(label, `${label}缺失或不是数字（实际为 ${typeOf(v)}）`);
    } else if (v < 1 || v > 10) {
      at(label, `${label}超出 1-10 范围：${v}`);
    }
  }

  // 配置枚举
  for (const { key, label, allowed } of ENUM_META) {
    const v = o[key as string];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      at(label, `${label}缺失或为非法枚举值：${v === undefined ? '缺失' : String(v)}`);
    }
  }

  // soundTags：必须是字符串数组，且每个元素为非空字符串（旧版本可缺失，缺失补齐为 []）
  if (o.soundTags === undefined) {
    // 旧版本无此字段：允许，稍后补齐为 []
  } else if (!Array.isArray(o.soundTags)) {
    at('声音标签', `声音标签结构非法（应为字符串数组，实际为 ${typeOf(o.soundTags)}）`);
  } else {
    o.soundTags.forEach((t, i) => {
      if (typeof t !== 'string') {
        at('声音标签', `声音标签第 ${i + 1} 项不是字符串（实际为 ${typeOf(t)}）`);
      } else if (t.trim() === '') {
        at('声音标签', `声音标签第 ${i + 1} 项为空字符串`);
      }
    });
  }

  // 时间戳：旧版本缺失可默认；存在但类型不是字符串则判损坏
  for (const [key, label] of [
    ['createdAt', '创建时间'],
    ['updatedAt', '更新时间'],
  ] as const) {
    const v = o[key];
    if (v !== undefined && typeof v !== 'string') {
      at(label, `${label}类型错误（应为字符串，实际为 ${typeOf(v)}）`);
    }
  }

  // 旧版本可缺失的可选字符串：缺失稍后补齐；存在但类型不是字符串则判损坏
  for (const key of OPTIONAL_STRING_FIELDS) {
    const v = o[key as string];
    if (v !== undefined && typeof v !== 'string') {
      at(key, `${key} 类型错误（应为字符串，实际为 ${typeOf(v)}）`);
    }
  }

  if (issues.length > 0) return { log: null, issues };

  // ---- 通过严格字段校验后，仅对旧版本可缺失的可选字段做显式补齐 ----
  const base = { ...o } as Record<string, unknown>;

  for (const key of OPTIONAL_STRING_FIELDS) {
    if (base[key as string] === undefined) base[key as string] = '';
  }
  if (base.soundTags === undefined) base.soundTags = [];
  // 旧版本时间戳缺失：以入手日期补齐为合法 ISO 字符串
  const fallbackTs = new Date(`${String(o.purchaseDate)}T00:00:00.000Z`).toISOString();
  for (const key of ['createdAt', 'updatedAt'] as const) {
    if (base[key] === undefined) base[key] = fallbackTs;
  }

  return { log: base as unknown as KeyboardLog, issues: [] };
}

/**
 * 校验并迁移本地记录数组。
 * 只要有任意一条残缺，即整体判为损坏（交由恢复窗口接管），不返回半成品列表。
 */
export function validateAndMigrateLocalLogs(parsed: unknown[]): LocalLoadResult {
  const logs: KeyboardLog[] = [];
  const issues: LocalLogIssue[] = [];

  parsed.forEach((raw, index) => {
    const { log, issues: rowIssues } = processOne(raw, index);
    if (rowIssues.length > 0 || !log) {
      issues.push(...rowIssues);
    } else {
      logs.push(log);
    }
  });

  return { ok: issues.length === 0, logs: issues.length === 0 ? logs : [], issues };
}

/** 把问题列表格式化成恢复窗口可读的多行说明（第 N 条：字段——原因）。 */
export function formatLocalIssues(issues: LocalLogIssue[], maxShown = 8): string {
  const shown = issues.slice(0, maxShown);
  const lines = shown.map((i) => `· 第 ${i.index + 1} 条 · ${i.field}：${i.reason}`);
  if (issues.length > maxShown) {
    lines.push(`…以及另外 ${issues.length - maxShown} 处问题，请用编辑器逐条核对`);
  }
  return lines.join('\n');
}
