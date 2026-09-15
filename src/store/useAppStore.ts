import { create } from 'zustand';
import type { KeyboardLog, FilterState, UIState, ViewMode } from '@/types';
import { sampleData } from '@/data/sampleData';
import type { ImportApplyResult, ValidatedLog } from '@/utils/importExport';
import { applyImport, genNewId, downloadJsonFile } from '@/utils/importExport';

const STORAGE_KEY = 'keyfeeling-logs-v1';

/**
 * 读取状态。绝不允许在损坏/读取异常时静默回退示例数据：
 * - 'first-visit' 从未访问（无此键）：内存展示示例，但明确标注“非已保存”，且不写盘；
 * - 'empty' 已持久化的空列表 []：刷新后保持空，与首次访问严格区分；
 * - 'ready' 已成功读取并通过结构校验的持久化数据；
 * - 'corrupt' 键存在但 JSON 解析失败或结构非法：保留原始内容，logs 为空，等待用户处理；
 * - 'error' localStorage.getItem 本身抛错（被禁用/隐私模式）：无原始内容可导出。
 */
export type LoadState = 'first-visit' | 'empty' | 'ready' | 'corrupt' | 'error';

export interface InitialLoad {
  state: LoadState;
  logs: KeyboardLog[];
  /** 损坏时保留的原始字符串（读取异常时为 null） */
  raw: string | null;
  /** 失败原因（损坏/异常时） */
  error: string | null;
}

/** 仅做防止崩溃的最小结构校验；导入文件的严格校验仍由 importExport 负责。 */
function isUsableLog(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.trim() === '') return false;
  if (typeof o.name !== 'string') return false;
  if (typeof o.overallRating !== 'number' || !Number.isFinite(o.overallRating)) return false;
  if (!Array.isArray(o.soundTags) || !o.soundTags.every((t) => typeof t === 'string')) return false;
  return true;
}

function performInitialLoad(): InitialLoad {
  // 1) 读取这一步本身可能抛错（存储被禁用等）
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return {
      state: 'error',
      logs: [],
      raw: null,
      error:
        '无法读取本地存储（可能处于隐私模式或浏览器禁用了存储）：' +
        (e instanceof Error ? e.message : String(e)),
    };
  }

  // 2) 从未访问：展示示例数据，但不写盘、不冒充已保存数据
  if (raw === null) {
    return { state: 'first-visit', logs: sampleData, raw: null, error: null };
  }

  // 3) 解析失败：保留原始损坏内容
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      state: 'corrupt',
      logs: [],
      raw,
      error: '本地数据不是合法 JSON，解析失败：' + (e instanceof Error ? e.message : String(e)),
    };
  }

  // 4) 已持久化的空列表：必须与首次访问区分，刷新保持空
  if (Array.isArray(parsed) && parsed.length === 0) {
    return { state: 'empty', logs: [], raw, error: null };
  }

  // 5) 结构必须是记录数组且每条通过最小校验
  if (!Array.isArray(parsed)) {
    return {
      state: 'corrupt',
      logs: [],
      raw,
      error: `本地数据结构非法：期望记录数组，实际为 ${parsed === null ? 'null' : typeof parsed}`,
    };
  }
  const badIndex = parsed.findIndex((x) => !isUsableLog(x));
  if (badIndex >= 0) {
    return {
      state: 'corrupt',
      logs: [],
      raw,
      error: `本地数据第 ${badIndex + 1} 条记录结构损坏（缺少编号/名称，或评分、标签字段非法）`,
    };
  }

  return { state: 'ready', logs: parsed as KeyboardLog[], raw, error: null };
}

/** 供“重试”复用：重新读取并判定。 */
function retryLoadFromStorage(): InitialLoad {
  return performInitialLoad();
}

/**
 * 写入持久化记录。任何不可写（隐私模式/被禁用）、配额不足或序列化失败都抛错；
 * 写入后回读比对，防止静默失败。调用方必须先落盘成功再更新内存。
 */
function saveToStorage(logs: KeyboardLog[]): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(logs);
  } catch (e) {
    throw new Error(
      '数据无法序列化，保存失败：' + (e instanceof Error ? e.message : String(e)),
    );
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (e) {
    const reason = e instanceof Error ? e : new Error(String(e));
    const quota =
      reason.name === 'QuotaExceededError' ||
      reason.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      /quota/i.test(reason.message);
    throw new Error(
      quota
        ? '本地存储空间不足，保存失败。请导出备份后清理浏览器存储空间。'
        : '本地存储不可写（可能处于隐私模式或被浏览器禁用），保存失败。',
    );
  }
  // 回读校验：个别环境 setItem 不抛错但实际未写入
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== serialized) {
      throw new Error('写入校验失败：本地存储内容与预期不一致。');
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('写入校验失败')) throw e;
    throw new Error('本地存储写入后无法读取，保存失败。');
  }
}

export interface MutationResult {
  ok: boolean;
  error?: string;
}

/** 数据损坏/读取异常期间禁止任何会写盘的操作，避免覆盖用户可恢复的原始内容。 */
function mutationBlocked(get: () => AppState): MutationResult | null {
  const s = get().loadState;
  if (s === 'corrupt' || s === 'error') {
    return {
      ok: false,
      error:
        s === 'corrupt'
          ? '本地数据已损坏，写操作已锁定，请先在恢复窗口中重试或备份后清空重建'
          : '本地存储不可用，写操作已锁定，请先在恢复窗口中重试',
    };
  }
  return null;
}

function emptyApplyResult(): ImportApplyResult {
  return {
    toAdd: [],
    toOverwrite: [],
    toRegenerate: [],
    skipped: [],
    finalLogs: [],
    stats: { added: 0, overwritten: 0, regenerated: 0, skipped: 0 },
  };
}

interface AppState {
  logs: KeyboardLog[];
  filter: FilterState;
  ui: UIState;
  /** 初始/最近一次读取本地存储的状态 */
  loadState: LoadState;
  /** 损坏时保留的原始内容（读取异常为 null） */
  corruptedRaw: string | null;
  /** 读取失败原因（corrupt/error） */
  loadError: string | null;
  /** 最近一次持久化失败信息，用于界面明确提示；成功后置空 */
  storageError: string | null;
  /** 重新读取本地存储；成功恢复原列表，失败保持恢复弹窗 */
  retryLoad: () => MutationResult;
  /** 下载损坏的原始内容作为备份文件；无原始内容（读取异常）时返回失败 */
  exportCorruptedRaw: () => MutationResult;
  /** 二次确认且已备份后清空损坏数据并重建为空列表 */
  resetAfterBackup: () => MutationResult;
  dismissStorageError: () => void;
  setFilter: (patch: Partial<FilterState>) => void;
  resetFilter: () => void;
  createLog: (data: Omit<KeyboardLog, 'id' | 'createdAt' | 'updatedAt'>) => MutationResult;
  updateLog: (id: string, data: Partial<KeyboardLog>) => MutationResult;
  deleteLog: (id: string) => MutationResult;
  importLogs: (
    selectedForImport: string[],
    fileValidLogs: KeyboardLog[],
    duplicateWithExisting: ValidatedLog[],
    strategy: 'skip' | 'overwrite' | 'regenerate',
  ) => ImportApplyResult & MutationResult;
  setViewMode: (mode: ViewMode) => void;
  toggleCompareSelect: (id: string) => void;
  clearCompareSelect: () => void;
  openFormModal: (log?: KeyboardLog | null) => void;
  closeFormModal: () => void;
  openDetail: (log: KeyboardLog) => void;
  closeDetail: () => void;
  openImportExport: () => void;
  closeImportExport: () => void;
}

const defaultFilter: FilterState = {
  switchType: 'all',
  soundCharacter: 'all',
  minRating: 0,
  searchKeyword: '',
};

const defaultUI: UIState = {
  viewMode: 'list',
  selectedForCompare: [],
  formModalOpen: false,
  editingLog: null,
  detailLog: null,
  importExportModalOpen: false,
};

const initialLoad = performInitialLoad();

export const useAppStore = create<AppState>((set, get) => ({
  logs: initialLoad.logs,
  filter: defaultFilter,
  ui: defaultUI,
  loadState: initialLoad.state,
  corruptedRaw: initialLoad.raw,
  loadError: initialLoad.error,
  storageError: null,

  dismissStorageError: () => set({ storageError: null }),

  retryLoad: () => {
    const r = retryLoadFromStorage();
    if (r.state === 'corrupt' || r.state === 'error') {
      // 重试仍失败：保留现状（含原始损坏内容），恢复窗口不关闭
      set({ loadState: r.state, logs: r.logs, corruptedRaw: r.raw, loadError: r.error });
      return { ok: false, error: r.error ?? '读取仍然失败' };
    }
    // 重试成功：恢复读到的原列表（或首次访问示例 / 空列表）
    set({
      loadState: r.state,
      logs: r.logs,
      corruptedRaw: null,
      loadError: null,
      storageError: null,
      ui: { ...defaultUI },
    });
    return { ok: true };
  },

  exportCorruptedRaw: () => {
    const raw = get().corruptedRaw;
    if (raw === null) {
      return { ok: false, error: '读取本地存储时即抛错，没有可导出的原始内容' };
    }
    try {
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      downloadJsonFile(raw, `keyfeeling-corrupt-backup-${dateStr}.json`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '导出备份失败：' + (e instanceof Error ? e.message : String(e)) };
    }
  },

  resetAfterBackup: () => {
    // 必须由 UI 在“已下载备份 + 二次确认”后调用
    try {
      saveToStorage([]);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ storageError: error });
      return { ok: false, error };
    }
    set({
      logs: [],
      loadState: 'empty',
      corruptedRaw: null,
      loadError: null,
      storageError: null,
      ui: { ...defaultUI },
    });
    return { ok: true };
  },

  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: defaultFilter }),

  createLog: (data) => {
    const blocked = mutationBlocked(get);
    if (blocked) return blocked;
    const now = new Date().toISOString();
    const newLog: KeyboardLog = {
      ...data,
      id: genNewId(),
      createdAt: now,
      updatedAt: now,
    };
    const next = [newLog, ...get().logs];
    try {
      saveToStorage(next);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ storageError: error });
      return { ok: false, error };
    }
    // 落盘成功后才提交内存；首次访问/空列表自此转为已持久化数据
    set({
      logs: next,
      loadState: 'ready',
      storageError: null,
      ui: { ...get().ui, formModalOpen: false, editingLog: null },
    });
    return { ok: true };
  },

  updateLog: (id, data) => {
    const blocked = mutationBlocked(get);
    if (blocked) return blocked;
    const next = get().logs.map((l) =>
      l.id === id ? { ...l, ...data, updatedAt: new Date().toISOString() } : l,
    );
    try {
      saveToStorage(next);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ storageError: error });
      return { ok: false, error };
    }
    set({
      logs: next,
      loadState: 'ready',
      storageError: null,
      ui: { ...get().ui, formModalOpen: false, editingLog: null },
    });
    return { ok: true };
  },

  deleteLog: (id) => {
    const blocked = mutationBlocked(get);
    if (blocked) return blocked;
    const next = get().logs.filter((l) => l.id !== id);
    try {
      // 关键：空数组同样落盘，刷新后保持空列表
      saveToStorage(next);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ storageError: error });
      return { ok: false, error };
    }
    const selected = get().ui.selectedForCompare.filter((sid) => sid !== id);
    set({
      logs: next,
      loadState: next.length === 0 ? 'empty' : 'ready',
      storageError: null,
      ui: { ...get().ui, selectedForCompare: selected, detailLog: null },
    });
    return { ok: true };
  },

  importLogs: (selectedForImport, fileValidLogs, duplicateWithExisting, strategy) => {
    const blocked = mutationBlocked(get);
    if (blocked) return { ...emptyApplyResult(), ...blocked };
    const result = applyImport(
      get().logs,
      selectedForImport,
      fileValidLogs,
      duplicateWithExisting,
      strategy,
    );
    // 先整部落盘，失败则内存保持原状，界面按失败处理
    try {
      saveToStorage(result.finalLogs);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ storageError: error });
      return { ...result, ok: false, error };
    }
    set({
      logs: result.finalLogs,
      loadState: result.finalLogs.length === 0 ? 'empty' : 'ready',
      storageError: null,
    });
    return { ...result, ok: true };
  },

  setViewMode: (mode) => set({ ui: { ...get().ui, viewMode: mode } }),

  toggleCompareSelect: (id) => {
    const cur = get().ui.selectedForCompare;
    let next: string[];
    if (cur.includes(id)) {
      next = cur.filter((x) => x !== id);
    } else if (cur.length >= 2) {
      next = [cur[1], id];
    } else {
      next = [...cur, id];
    }
    set({ ui: { ...get().ui, selectedForCompare: next } });
  },

  clearCompareSelect: () =>
    set({ ui: { ...get().ui, selectedForCompare: [], viewMode: 'list' } }),

  openFormModal: (log) =>
    set({ ui: { ...get().ui, formModalOpen: true, editingLog: log ?? null } }),
  closeFormModal: () => set({ ui: { ...get().ui, formModalOpen: false, editingLog: null } }),

  openDetail: (log) => set({ ui: { ...get().ui, detailLog: log } }),
  closeDetail: () => set({ ui: { ...get().ui, detailLog: null } }),

  openImportExport: () => set({ ui: { ...get().ui, importExportModalOpen: true } }),
  closeImportExport: () => set({ ui: { ...get().ui, importExportModalOpen: false } }),
}));

export function useFilteredLogs(): KeyboardLog[] {
  const { logs, filter } = useAppStore();
  const { switchType, soundCharacter, minRating, searchKeyword } = filter;
  const kw = searchKeyword.trim().toLowerCase();
  return logs.filter((log) => {
    if (switchType !== 'all' && log.switchType !== switchType) return false;
    if (soundCharacter !== 'all' && log.soundCharacter !== soundCharacter) return false;
    if (log.overallRating < minRating) return false;
    if (kw) {
      const haystack = [
        log.name,
        log.brand,
        log.model,
        log.switchName,
        log.notes,
        log.keycapProcess,
        ...log.soundTags,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
}
