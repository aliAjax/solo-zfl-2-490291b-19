import type { KeyboardLog } from '@/types';
import {
  SWITCH_TYPES,
  SOUND_CHARACTERS,
  KEYCAP_MATERIALS,
  KEYCAP_PROFILES,
  PLATE_MATERIALS,
  CASE_MATERIALS,
} from '@/types';

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_FORMAT_MAGIC = 'keyfeeling-export';

export type DuplicateStrategy = 'skip' | 'overwrite' | 'regenerate';

export interface ExportEnvelope {
  format: string;
  version: number;
  exportedAt: string;
  recordCount: number;
  data: KeyboardLog[];
}

export interface ImportRejectItem {
  /** 0-based 下标，界面展示时 +1 */
  index: number;
  reason: string;
  id?: string;
}

export interface ImportParseResult {
  /** 仅当整份文件全部记录校验通过时才非空，否则为空数组（整批拒绝，不允许落盘） */
  fileValidLogs: KeyboardLog[];
  /** 结构/语义非法的记录位置与原因 */
  fileInvalidItems: ImportRejectItem[];
  /** 文件内编号重复的记录位置（整份文件会因此被拒绝） */
  fileInternalDuplicates: Array<{ index: number; id: string; raw: unknown }>;
  totalParsed: number;
  /** 整批是否被拒绝（存在非法记录或文件内重复编号） */
  rejected: boolean;
  envelope?: ExportEnvelope;
}

export interface ImportApplyResult {
  toAdd: KeyboardLog[];
  toOverwrite: KeyboardLog[];
  toRegenerate: KeyboardLog[];
  skipped: KeyboardLog[];
  finalLogs: KeyboardLog[];
  stats: {
    added: number;
    overwritten: number;
    regenerated: number;
    skipped: number;
  };
}

export interface ValidatedLog {
  log: KeyboardLog;
  isDuplicateExisting: boolean;
}

const REQUIRED_STRING_FIELDS: (keyof KeyboardLog)[] = [
  'id',
  'name',
  'brand',
  'model',
  'purchaseDate',
  'switchName',
  'switchType',
  'switchLubed',
  'keycapMaterial',
  'keycapProfile',
  'keycapProcess',
  'plateMaterial',
  'plateThickness',
  'fillMaterial',
  'caseMaterial',
  'soundCharacter',
  'notes',
  'createdAt',
  'updatedAt',
];

const RATING_FIELDS: (keyof KeyboardLog)[] = [
  'overallRating',
  'reboundRating',
  'tactilityRating',
  'fatigueRating',
];

const RATING_FIELD_LABELS: Record<string, string> = {
  overallRating: '整体评分',
  reboundRating: '回弹评分',
  tactilityRating: '段落评分',
  fatigueRating: '疲劳评分',
};

/**
 * 校验 YYYY-MM-DD 是否为真实存在的日历日期（拒绝 2025-02-31、2025-13-01 等）。
 * 回读后必须与输入完全一致，避免 Date 自动滚动到下一个月。
 */
function isValidCalendarDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function isValidSwitchType(v: unknown): v is KeyboardLog['switchType'] {
  return typeof v === 'string' && SWITCH_TYPES.includes(v as never);
}

function isValidSoundCharacter(v: unknown): v is KeyboardLog['soundCharacter'] {
  return typeof v === 'string' && SOUND_CHARACTERS.includes(v as never);
}

function isValidKeycapMaterial(v: unknown): v is KeyboardLog['keycapMaterial'] {
  return typeof v === 'string' && KEYCAP_MATERIALS.includes(v as never);
}

function isValidKeycapProfile(v: unknown): v is KeyboardLog['keycapProfile'] {
  return typeof v === 'string' && KEYCAP_PROFILES.includes(v as never);
}

function isValidPlateMaterial(v: unknown): v is KeyboardLog['plateMaterial'] {
  return typeof v === 'string' && PLATE_MATERIALS.includes(v as never);
}

function isValidCaseMaterial(v: unknown): v is KeyboardLog['caseMaterial'] {
  return typeof v === 'string' && CASE_MATERIALS.includes(v as never);
}

export function genNewId(): string {
  return 'log-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '-' + Math.random().toString(36).slice(2, 6);
}

function validateLog(raw: unknown): { valid: boolean; reason?: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, reason: '不是有效的记录对象' };
  }

  const obj = raw as Record<string, unknown>;

  // id 单独校验：必须是非空字符串
  if (typeof obj.id !== 'string') {
    return { valid: false, reason: '编号 id 缺失或类型错误（必须为字符串）' };
  }
  if (obj.id.trim() === '') {
    return { valid: false, reason: '编号 id 为空' };
  }

  // 其余必填字符串字段（id 已单独处理）
  for (const field of REQUIRED_STRING_FIELDS) {
    if (field === 'id') continue;
    if (typeof obj[field] !== 'string') {
      return { valid: false, reason: `缺少或无效的字段: ${String(field)}` };
    }
  }

  // 入手日期必须是真实存在的日历日期
  if (!isValidCalendarDate(obj.purchaseDate as string)) {
    return {
      valid: false,
      reason: `入手日期不存在或格式错误（应为 YYYY-MM-DD）: ${String(obj.purchaseDate)}`,
    };
  }

  // 评分必须是 1-10 的有限数值
  for (const field of RATING_FIELDS) {
    const v = obj[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return {
        valid: false,
        reason: `${RATING_FIELD_LABELS[field as string] ?? field} 缺失或不是数字`,
      };
    }
    if (v < 1 || v > 10) {
      return {
        valid: false,
        reason: `${RATING_FIELD_LABELS[field as string] ?? field} 超出 1-10 范围: ${v}`,
      };
    }
  }

  // soundTags 必须是字符串数组（元素不允许为空串以外的非字符串/嵌套结构）
  if (!Array.isArray(obj.soundTags)) {
    return { valid: false, reason: 'soundTags 标签结构非法：必须是字符串数组' };
  }
  if (
    !obj.soundTags.every(
      (t) => typeof t === 'string' && t.trim() !== '',
    )
  ) {
    return { valid: false, reason: 'soundTags 标签结构非法：每个标签必须是非空字符串' };
  }

  if (!isValidSwitchType(obj.switchType)) {
    return { valid: false, reason: `无效的轴体类型: ${String(obj.switchType)}` };
  }
  if (!isValidSoundCharacter(obj.soundCharacter)) {
    return { valid: false, reason: `无效的声音倾向: ${String(obj.soundCharacter)}` };
  }
  if (!isValidKeycapMaterial(obj.keycapMaterial)) {
    return { valid: false, reason: `无效的键帽材质: ${String(obj.keycapMaterial)}` };
  }
  if (!isValidKeycapProfile(obj.keycapProfile)) {
    return { valid: false, reason: `无效的键帽高度: ${String(obj.keycapProfile)}` };
  }
  if (!isValidPlateMaterial(obj.plateMaterial)) {
    return { valid: false, reason: `无效的定位板材质: ${String(obj.plateMaterial)}` };
  }
  if (!isValidCaseMaterial(obj.caseMaterial)) {
    return { valid: false, reason: `无效的外壳材质: ${String(obj.caseMaterial)}` };
  }

  return { valid: true };
}

/**
 * 整份文件解析 + 全量校验。
 * 任意一条记录非法（编号空/文件内重复、日期不存在、评分越界、标签结构非法等），
 * 整批拒绝：fileValidLogs 为空、rejected 为 true，不允许任何记录落盘。
 */
export function parseImportData(rawJson: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    throw new Error('JSON 解析失败：' + (e instanceof Error ? e.message : String(e)));
  }

  let envelope: ExportEnvelope | undefined;
  let rawArray: unknown[];

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    'format' in parsed &&
    (parsed as { format?: unknown }).format === EXPORT_FORMAT_MAGIC &&
    'data' in parsed &&
    Array.isArray((parsed as { data: unknown }).data)
  ) {
    envelope = parsed as ExportEnvelope;
    rawArray = envelope.data;
  } else if (Array.isArray(parsed)) {
    rawArray = parsed;
  } else {
    throw new Error('JSON 根节点必须是数组或有效的 KeyFeeling 导出格式');
  }

  const fileInvalidItems: ImportRejectItem[] = [];
  const fileInternalDuplicates: Array<{ index: number; id: string; raw: unknown }> = [];
  const validLogs: KeyboardLog[] = [];
  const seenIds = new Map<string, number>(); // id -> 首次出现的下标

  // 单轮遍历：结构/语义校验 + 文件内编号重复检测
  rawArray.forEach((item, index) => {
    const result = validateLog(item);
    if (!result.valid) {
      const reject: ImportRejectItem = { index, reason: result.reason || '未知错误' };
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === 'string'
      ) {
        reject.id = (item as Record<string, string>).id;
      }
      fileInvalidItems.push(reject);
      return;
    }

    const log = item as KeyboardLog;
    if (seenIds.has(log.id)) {
      fileInternalDuplicates.push({ index, id: log.id, raw: item });
      return;
    }
    seenIds.set(log.id, index);
    validLogs.push(log);
  });

  const rejected = fileInvalidItems.length > 0 || fileInternalDuplicates.length > 0;

  return {
    // 整批拒绝时不返回任何可落盘记录
    fileValidLogs: rejected ? [] : validLogs,
    fileInvalidItems,
    fileInternalDuplicates,
    totalParsed: rawArray.length,
    rejected,
    envelope,
  };
}

export function buildValidatedLogs(
  fileValidLogs: KeyboardLog[],
  existingLogs: KeyboardLog[],
): {
  newLogs: ValidatedLog[];
  duplicateWithExisting: ValidatedLog[];
} {
  const existingIdSet = new Set(existingLogs.map((l) => l.id));
  const newLogs: ValidatedLog[] = [];
  const duplicateWithExisting: ValidatedLog[] = [];

  for (const log of fileValidLogs) {
    const entry: ValidatedLog = {
      log,
      isDuplicateExisting: existingIdSet.has(log.id),
    };
    if (entry.isDuplicateExisting) {
      duplicateWithExisting.push(entry);
    } else {
      newLogs.push(entry);
    }
  }

  return { newLogs, duplicateWithExisting };
}

export function applyImport(
  existingLogs: KeyboardLog[],
  selectedForImport: string[],
  fileValidLogs: KeyboardLog[],
  duplicateWithExisting: ValidatedLog[],
  strategy: DuplicateStrategy,
): ImportApplyResult {
  const selectedSet = new Set(selectedForImport);

  const selectedNew = fileValidLogs
    .filter((log) => {
      if (!selectedSet.has(log.id)) return false;
      const dup = duplicateWithExisting.find((d) => d.log.id === log.id);
      return !dup;
    });

  const selectedDup = duplicateWithExisting
    .filter((d) => selectedSet.has(d.log.id));

  const toAdd: KeyboardLog[] = [];
  const toOverwrite: KeyboardLog[] = [];
  const toRegenerate: KeyboardLog[] = [];
  const skipped: KeyboardLog[] = [];

  for (const log of selectedNew) {
    toAdd.push(log);
  }

  // 已占用编号集合：现有 + 本次新增 + 本次已重新生成，逐条更新避免碰撞
  const usedIds = new Set<string>([
    ...existingLogs.map((l) => l.id),
    ...toAdd.map((l) => l.id),
  ]);

  for (const dup of selectedDup) {
    switch (strategy) {
      case 'skip':
        skipped.push(dup.log);
        break;
      case 'overwrite':
        toOverwrite.push({
          ...dup.log,
          updatedAt: new Date().toISOString(),
        });
        break;
      case 'regenerate': {
        let newId = genNewId();
        while (usedIds.has(newId)) {
          newId = genNewId();
        }
        usedIds.add(newId);
        toRegenerate.push({
          ...dup.log,
          id: newId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        break;
      }
    }
  }

  let finalLogs = [...existingLogs];

  for (const ow of toOverwrite) {
    const idx = finalLogs.findIndex((l) => l.id === ow.id);
    if (idx >= 0) {
      finalLogs[idx] = ow;
    } else {
      finalLogs.unshift(ow);
    }
  }

  finalLogs = [...toAdd, ...toRegenerate, ...finalLogs];

  return {
    toAdd,
    toOverwrite,
    toRegenerate,
    skipped,
    finalLogs,
    stats: {
      added: toAdd.length,
      overwritten: toOverwrite.length,
      regenerated: toRegenerate.length,
      skipped: skipped.length,
    },
  };
}

export function buildExportEnvelope(logs: KeyboardLog[]): ExportEnvelope {
  return {
    format: EXPORT_FORMAT_MAGIC,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    recordCount: logs.length,
    data: logs,
  };
}

export function exportToJson(logs: KeyboardLog[]): string {
  return JSON.stringify(buildExportEnvelope(logs), null, 2);
}

export function downloadJsonFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function generateExportFilename(): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `keyfeeling-export-${dateStr}.json`;
}
