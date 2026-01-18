// デバッグログを保存するグローバルストレージ
const debugLogs: Array<{ timestamp: number; source: string; data: any }> = [];

export function addDebugLog(source: string, data: any) {
  const logEntry = {
    timestamp: Date.now(),
    source,
    data: JSON.parse(JSON.stringify(data)) // ディープコピー
  };
  debugLogs.push(logEntry);
  // 最新100件のみ保持
  if (debugLogs.length > 100) {
    debugLogs.shift();
  }
  // localStorageにも保存
  try {
    const stored = debugLogs.slice(-50);
    localStorage.setItem('poker_debug_logs', JSON.stringify(stored));
  } catch (e) {
    // 容量制限などで失敗しても続行
  }
  // コンソールにも出力
  console.log(`[${source}]`, data);
}

export function getDebugLogs() {
  try {
    const stored = localStorage.getItem('poker_debug_logs');
    return stored ? JSON.parse(stored) : debugLogs;
  } catch (e) {
    return debugLogs;
  }
}

export function clearDebugLogs() {
  debugLogs.length = 0;
  try {
    localStorage.removeItem('poker_debug_logs');
  } catch (e) {
    // 無視
  }
}
