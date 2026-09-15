import FilterBar from './FilterBar';
import KeyboardCard from './KeyboardCard';
import { useFilteredLogs, useAppStore } from '@/store/useAppStore';
import { FolderOpen, Plus, Sparkles, Info } from 'lucide-react';

export default function ListView() {
  const logs = useFilteredLogs();
  const { openFormModal, ui, loadState } = useAppStore();
  const totalLogs = useAppStore((s) => s.logs.length);
  const isFirstVisit = loadState === 'first-visit';
  const isPersistedEmpty = loadState === 'empty' && totalLogs === 0;

  return (
    <div className="space-y-5">
      <FilterBar />

      {isFirstVisit && (
        <div className="flex items-start gap-3 rounded-xl border border-brass-300/30 bg-brass-300/5 px-4 py-3">
          <Sparkles className="h-4 w-4 text-brass-200 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-brass-100">
              当前为内置示例数据，尚未保存到本地
            </p>
            <p className="text-[11px] text-ink-400 mt-0.5 leading-relaxed">
              这些示例仅用于预览功能，并不是你已保存的记录。新建、导入或删除任意记录后，才会在本地存储建立属于你的数据文件；清空全部后刷新将保持空列表，示例不会再次出现。
            </p>
          </div>
          <Info className="h-3.5 w-3.5 text-brass-300/50 shrink-0 mt-0.5" />
        </div>
      )}

      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-mono text-ink-500">
          显示 <span className="text-brass-300">{logs.length}</span> 条记录
          {logs.length !== totalLogs && (
            <span className="text-ink-600">（共 {totalLogs} 条）</span>
          )}
        </p>
        {ui.selectedForCompare.length > 0 && (
          <p className="text-xs font-mono text-ink-400">
            已选 <span className="text-brass-300 font-bold">{ui.selectedForCompare.length}</span> / 2 条用于对比
            {ui.selectedForCompare.length < 2 && '，再选一条后进入对比视图'}
          </p>
        )}
      </div>

      {logs.length === 0 ? (
        <div className="card-surface flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="keycap !h-14 !w-14 !min-w-[56px] !rounded-xl !text-xl mb-4 opacity-60">
            <FolderOpen className="h-6 w-6" />
          </div>
          <h3 className="font-mono text-base font-semibold text-ink-200 mb-2">
            {isPersistedEmpty ? '还没有任何记录' : '没有找到匹配的记录'}
          </h3>
          <p className="text-sm text-ink-500 mb-6 max-w-sm">
            {isPersistedEmpty
              ? '本地数据是已保存的空列表，刷新后仍会保持为空。创建第一条键盘手感日志吧～'
              : '尝试调整筛选条件，或者创建你的第一条键盘手感日志吧～'}
          </p>
          <button onClick={() => openFormModal()} className="btn-primary">
            <Plus className="h-4 w-4" />
            创建第一条记录
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 md:gap-5">
          {logs.map((log, i) => (
            <KeyboardCard key={log.id} log={log} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
