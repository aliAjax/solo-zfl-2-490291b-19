import { create } from 'zustand';
import type { KeyboardLog, FilterState, UIState, ViewMode } from '@/types';
import { sampleData } from '@/data/sampleData';
import type { ImportApplyResult, ValidatedLog } from '@/utils/importExport';
import { applyImport, genNewId } from '@/utils/importExport';

const STORAGE_KEY = 'keyfeeling-logs-v1';

/**
 * 读取持久化记录。
 * 语义区分：
 * - 从未访问（localStorage 中无此键）→ 返回示例数据，不主动写入；
 * - 已持久化（含空数组 []）→ 原样返回。删光记录刷新后必须保持空列表。
 * 本地存储不可读或内容损坏时返回示例数据兜底（不代表已持久化）。
 */
function loadFromStorage(): KeyboardLog[] {
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      return sampleData;
    }
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
    if (Array.isArray(parsed)) return parsed as KeyboardLog[];
    return sampleData;
  } catch {
    return sampleData;
  }
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

interface AppState {
  logs: KeyboardLog[];
  filter: FilterState;
  ui: UIState;
  /** 最近一次持久化失败信息，用于界面明确提示；成功后置空 */
  storageError: string | null;
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

export const useAppStore = create<AppState>((set, get) => ({
  logs: loadFromStorage(),
  filter: defaultFilter,
  ui: defaultUI,
  storageError: null,

  dismissStorageError: () => set({ storageError: null }),

  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: defaultFilter }),

  createLog: (data) => {
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
    // 落盘成功后才提交内存
    set({
      logs: next,
      storageError: null,
      ui: { ...get().ui, formModalOpen: false, editingLog: null },
    });
    return { ok: true };
  },

  updateLog: (id, data) => {
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
      storageError: null,
      ui: { ...get().ui, formModalOpen: false, editingLog: null },
    });
    return { ok: true };
  },

  deleteLog: (id) => {
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
      storageError: null,
      ui: { ...get().ui, selectedForCompare: selected, detailLog: null },
    });
    return { ok: true };
  },

  importLogs: (selectedForImport, fileValidLogs, duplicateWithExisting, strategy) => {
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
    set({ logs: result.finalLogs, storageError: null });
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
