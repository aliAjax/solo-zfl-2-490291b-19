import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertOctagon,
  RefreshCw,
  Download,
  Trash2,
  ShieldAlert,
  CheckCircle2,
  Lock,
  FileWarning,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

const RAW_PREVIEW_LIMIT = 4000;

/**
 * 本地数据读取失败时的阻塞式恢复窗口（corrupt / error）。
 * 不允许跳过或关闭——读失败时绝不静默回退示例数据，必须显式选择：
 * 重试读取 / 导出原始内容 / 备份后二次确认清空重建。
 */
export default function DataRecoveryModal() {
  const loadState = useAppStore((s) => s.loadState);
  const loadError = useAppStore((s) => s.loadError);
  const loadIssues = useAppStore((s) => s.loadIssues);
  const corruptedRaw = useAppStore((s) => s.corruptedRaw);
  const retryLoad = useAppStore((s) => s.retryLoad);
  const exportCorruptedRaw = useAppStore((s) => s.exportCorruptedRaw);
  const resetAfterBackup = useAppStore((s) => s.resetAfterBackup);

  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const open = loadState === 'corrupt' || loadState === 'error';

  const rawPreview = useMemo(() => {
    if (corruptedRaw === null) return '';
    return corruptedRaw.length > RAW_PREVIEW_LIMIT
      ? corruptedRaw.slice(0, RAW_PREVIEW_LIMIT) + '\n…（内容过长，已截断预览；导出的备份为完整原始内容）'
      : corruptedRaw;
  }, [corruptedRaw]);

  if (!open) return null;

  const isCorrupt = loadState === 'corrupt';

  const handleRetry = () => {
    setRetryMsg(null);
    const r = retryLoad();
    if (!r.ok) {
      setRetryMsg(r.error ?? '重试后仍然读取失败');
    }
    // 成功时 loadState 改变，本组件整体卸载，无需处理
  };

  const handleExport = () => {
    const r = exportCorruptedRaw();
    if (r.ok) {
      setBackedUp(true);
      setBackupMsg('原始内容已下载为备份文件，请妥善保存。');
    } else {
      setBackupMsg(r.error ?? '导出失败');
    }
  };

  const handleReset = () => {
    const r = resetAfterBackup();
    if (!r.ok) {
      setResetMsg(r.error ?? '清空重建失败');
    }
    // 成功时 loadState 变为 empty，组件卸载
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-ink-950/85 backdrop-blur-sm">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto scrollbar-thin rounded-2xl border border-wine-500/50 bg-ink-900 shadow-2xl shadow-wine-950/50">
        {/* 头部：不可关闭 */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-wine-500/30 bg-wine-500/10">
          <div className="p-2.5 rounded-xl bg-wine-500/20 text-wine-300 shrink-0">
            {isCorrupt ? <FileWarning className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-mono text-base font-bold text-wine-200">
              本地数据读取失败
            </h2>
            <p className="text-xs text-ink-400 mt-0.5">
              {isCorrupt
                ? '已保留损坏的原始内容，不会用示例数据覆盖，请选择恢复方式'
                : '浏览器阻止了本地存储访问，当前无法读取或保存数据'}
            </p>
          </div>
          <Lock className="h-4 w-4 text-wine-400/60 shrink-0 self-start" />
        </div>

        <div className="p-6 space-y-5">
          {/* 错误详情 */}
          <div className="rounded-lg border border-wine-500/30 bg-wine-500/5 p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertOctagon className="h-4 w-4 text-wine-400 shrink-0" />
              <span className="text-xs font-mono font-semibold text-wine-300">
                {loadIssues.length > 0 ? `发现 ${loadIssues.length} 处字段问题` : '失败原因'}
              </span>
            </div>
            {loadIssues.length > 0 ? (
              <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-1 pr-1">
                {loadIssues.slice(0, 50).map((iss, i) => (
                  <div key={i} className="text-[11px] leading-relaxed flex items-start gap-1.5">
                    <span className="font-mono text-wine-400/80 shrink-0">
                      第 {iss.index + 1} 条
                    </span>
                    <span className="text-wine-200/90 font-medium shrink-0">{iss.field}</span>
                    <span className="text-wine-100/70 break-words">— {iss.reason}</span>
                  </div>
                ))}
                {loadIssues.length > 50 && (
                  <div className="text-[11px] text-ink-500 pt-1 border-t border-wine-500/20">
                    …还有 {loadIssues.length - 50} 处问题
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-wine-100/80 leading-relaxed whitespace-pre-wrap break-words">
                {loadError ?? '未知错误'}
              </p>
            )}
          </div>

          {/* 原始内容预览 */}
          {isCorrupt && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-ink-500">
                  保留的原始内容（未被修改）
                </span>
                <span className="text-[10px] font-mono text-ink-600">
                  {corruptedRaw?.length ?? 0} 字符
                </span>
              </div>
              <pre className="max-h-36 overflow-auto scrollbar-thin rounded-lg bg-ink-950/70 border border-ink-700/60 p-3 text-[11px] font-mono text-ink-400 whitespace-pre-wrap break-all">
                {rawPreview || '（空）'}
              </pre>
            </div>
          )}

          {/* 选项 1：重试 */}
          <div className="rounded-xl border border-ink-700/60 bg-ink-950/40 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-moss-500/15 text-moss-400 shrink-0">
                <RefreshCw className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink-100">重试读取</p>
                <p className="text-[11px] text-ink-500 mt-0.5">
                  若你刚修复了存储权限或外部程序占用，重试成功后将直接恢复原来的列表。
                </p>
              </div>
              <button onClick={handleRetry} className="btn-secondary text-xs shrink-0">
                <RefreshCw className="h-3.5 w-3.5" />
                重试
              </button>
            </div>
            {retryMsg && (
              <p className="text-[11px] text-wine-300 pl-9 break-words">重试仍失败：{retryMsg}</p>
            )}
          </div>

          {/* 选项 2：导出原始内容 */}
          <div className="rounded-xl border border-ink-700/60 bg-ink-950/40 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-brass-300/15 text-brass-200 shrink-0">
                <Download className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink-100">导出原始内容备份</p>
                <p className="text-[11px] text-ink-500 mt-0.5">
                  {isCorrupt
                    ? '先把损坏的原始内容下载留档，避免清空后无法找回。'
                    : '读取时即被浏览器拒绝，没有可导出的原始内容。'}
                </p>
              </div>
              <button
                onClick={handleExport}
                disabled={!isCorrupt}
                className="btn-secondary text-xs shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="h-3.5 w-3.5" />
                下载备份
              </button>
            </div>
            {backupMsg && (
              <div
                className={`flex items-start gap-2 pl-9 text-[11px] ${
                  backedUp ? 'text-moss-400' : 'text-wine-300'
                }`}
              >
                {backedUp && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
                <span>{backupMsg}</span>
              </div>
            )}
          </div>

          {/* 选项 3：清空重建（必须先备份 + 二次确认） */}
          <div className="rounded-xl border border-wine-500/30 bg-wine-500/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-1.5 rounded-md bg-wine-500/20 text-wine-300 shrink-0">
                <Trash2 className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-ink-100">清空并重建为空列表</p>
                <p className="text-[11px] text-ink-500 mt-0.5">
                  丢弃无法读取的本地数据，从空白重新开始。
                  {isCorrupt ? '为防数据丢失，必须先下载备份。' : '建议先确认浏览器存储权限已开启。'}
                </p>
              </div>
            </div>

            {!confirmStep ? (
              <div className="pl-9">
                <button
                  onClick={() => setConfirmStep(true)}
                  disabled={isCorrupt && !backedUp}
                  className="w-full btn-primary justify-center disabled:opacity-40 disabled:cursor-not-allowed !bg-wine-600/80 hover:!bg-wine-600 !border-wine-500/50"
                >
                  <Trash2 className="h-4 w-4" />
                  {isCorrupt && !backedUp ? '请先下载原始内容备份' : '我已备份，继续清空'}
                </button>
              </div>
            ) : (
              <div className="pl-9 space-y-2.5 rounded-lg border border-wine-500/40 bg-wine-500/10 p-3">
                <p className="text-xs font-semibold text-wine-200">
                  再次确认：将永久清除当前无法读取的本地数据并重建为空列表，此操作不可撤销。
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmStep(false)}
                    className="flex-1 btn-secondary justify-center text-xs"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleReset}
                    className="flex-1 btn-primary justify-center text-xs !bg-wine-600 hover:!bg-wine-500 !border-wine-500/60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    确认清空并重建
                  </button>
                </div>
                {resetMsg && <p className="text-[11px] text-wine-300 break-words">{resetMsg}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
