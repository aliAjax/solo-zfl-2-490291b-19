import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

/**
 * 持久化失败时的全局醒目提示（fixed 浮层，盖在 modal 之上）。
 * 只要 saveToStorage 失败就展示，明确告知用户本次修改没有保存，
 * 避免界面仍停留在“看似成功”的状态。
 */
export default function StorageErrorBanner() {
  const storageError = useAppStore((s) => s.storageError);
  const dismissStorageError = useAppStore((s) => s.dismissStorageError);

  if (!storageError) return null;

  return createPortal(
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[min(92vw,560px)] animate-fadeIn">
      <div
        role="alert"
        className="flex items-start gap-3 rounded-xl border border-wine-500/50 bg-wine-500/15 backdrop-blur-md px-4 py-3 shadow-2xl shadow-wine-950/40"
      >
        <AlertTriangle className="h-5 w-5 text-wine-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-wine-200 mb-0.5">保存失败</p>
          <p className="text-xs text-wine-100/80 leading-relaxed break-words">{storageError}</p>
          <p className="text-[11px] text-ink-400 mt-1">
            本次改动未写入本地存储，刷新后会丢失；当前列表仍保持保存前状态。
          </p>
        </div>
        <button
          onClick={dismissStorageError}
          className="p-1 rounded-md text-wine-200/70 hover:text-wine-100 hover:bg-wine-500/20 transition-colors shrink-0"
          aria-label="关闭提示"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
