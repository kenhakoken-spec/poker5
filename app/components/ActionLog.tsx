'use client';

import type { HandAction, Phase, Position, BoardState, OpponentType, OpponentStyle, HandResult } from '@/types/poker';
import { Copy, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { addDebugLog, getDebugLogs } from '@/lib/debugLogger';

interface ActionLogProps {
  actions: HandAction[];
  potSize: number;
  heroPosition: Position | null;
  heroHand?: [string, string];
  stackSize: number;
  board: BoardState;
  currentPhase: Phase;
  result?: HandResult; // Add result prop
}

export function ActionLog({ 
  actions, 
  potSize, 
  heroPosition, 
  heroHand, 
  stackSize, 
  board, 
  currentPhase,
  result,
}: ActionLogProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // スタック情報を計算（アクションによる変化を追跡）
  const calculateStackInfo = () => {
    let currentStack = stackSize;
    const stackChanges: Record<string, number> = {};
    
    actions.forEach((action) => {
      if (action.position === heroPosition && action.betSize) {
        currentStack -= action.betSize;
        if (!stackChanges[action.phase]) {
          stackChanges[action.phase] = 0;
        }
        stackChanges[action.phase] += action.betSize;
      }
    });

    return { currentStack, stackChanges, initialStack: stackSize };
  };

  // ボード情報をフォーマット
  const formatBoard = (): string => {
    const cards: string[] = [];
    if (board.flop) cards.push(...board.flop);
    if (board.turn) cards.push(board.turn);
    if (board.river) cards.push(board.river);
    return cards.length > 0 ? cards.join(' ') : 'No board';
  };

  // フェーズごとにアクションをグループ化
  const groupActionsByPhase = () => {
    const groups: Record<Phase, HandAction[]> = {
      Preflop: [],
      Flop: [],
      Turn: [],
      River: [],
    };

    actions.forEach((action) => {
      // action.phaseが有効なフェーズかチェック
      if (action.phase && action.phase in groups) {
        groups[action.phase].push(action);
      } else {
        // 無効なフェーズの場合はPreflopに分類（フォールバック）
        console.warn(`Invalid phase in action: ${action.phase}, defaulting to Preflop`);
        groups.Preflop.push(action);
      }
    });

    return groups;
  };

  const formatAction = (action: HandAction): string => {
    // DEBUG: ActionLog formatAction
    if (action.position !== heroPosition) {
      const debugData = {
        position: action.position,
        action: action.action,
        opponentType: action.opponentType,
        opponentStyle: action.opponentStyle,
        fullAction: action
      };
      console.log('[ActionLog] formatAction - non-hero action:', debugData);
      addDebugLog('[ActionLog] formatAction', debugData);
    }
    
    let actionStr = `${action.position}: ${action.action}`;
    if (action.betSize !== undefined) {
      actionStr += ` ${action.betSize.toFixed(1)}bb`;
    }
    if (action.position !== heroPosition) {
      const typeAndStyle: string[] = [];
      if (action.opponentType) {
        typeAndStyle.push(action.opponentType);
      }
      if (action.opponentStyle && action.opponentStyle !== 'unknown') {
        typeAndStyle.push(action.opponentStyle);
      }
      if (typeAndStyle.length > 0) {
        actionStr += ` (${typeAndStyle.join(', ')})`;
      }
      console.log('[ActionLog] formatAction - final string:', actionStr);
      addDebugLog('[ActionLog] formatAction - final', { actionStr, position: action.position });
    }
    return actionStr;
  };

  const formatPhaseActions = (phaseActions: HandAction[]): string => {
    return phaseActions.map(formatAction).join(', ');
  };

  // 分析用の詳細データを生成
  const generateAnalysisData = () => {
    const stackInfo = calculateStackInfo();
    
    return {
      sessionInfo: {
        heroPosition,
        heroHand: heroHand ? `${heroHand[0]}${heroHand[1]}` : 'Unknown',
        initialStack: stackSize,
        currentStack: stackInfo.currentStack,
        effectiveStack: stackSize,
      },
      boardInfo: {
        currentPhase,
        board: currentPhase !== 'Preflop' ? formatBoard() : 'No board (ended in Preflop)',
        flop: currentPhase !== 'Preflop' ? board.flop?.join(' ') : undefined,
        turn: currentPhase === 'Turn' || currentPhase === 'River' ? board.turn : undefined,
        river: currentPhase === 'River' ? board.river : undefined,
      },
      actionSequence: actions.map(action => ({
        phase: action.phase,
        position: action.position,
        action: action.action,
        betSize: action.betSize,
        potSizeAfter: action.potSize,
        opponentType: action.opponentType,
        opponentStyle: action.opponentStyle,
        isHero: action.position === heroPosition,
        timestamp: action.timestamp,
      })),
      potInfo: {
        finalPot: potSize,
        potByPhase: Object.entries(groupActionsByPhase()).map(([phase, phaseActions]) => ({
          phase,
          potAfterPhase: phaseActions.length > 0 ? phaseActions[phaseActions.length - 1].potSize : 0,
        })),
      },
      result: result ? {
        completionType: result.completionType,
        winner: result.winner,
        heroWon: result.heroWon,
        potAwarded: result.potAwarded,
        showdownHands: result.showdownHands.map(p => ({
          position: p.position,
          hand: p.hand ? `${p.hand[0]}${p.hand[1]}` : 'Mucked',
          mucked: p.mucked,
          isWinner: p.isWinner,
        })),
      } : null,
      summary: {
        totalActions: actions.length,
        heroActions: actions.filter(a => a.position === heroPosition).length,
        phases: Object.entries(groupActionsByPhase())
          .filter(([_, acts]) => acts.length > 0)
          .map(([phase]) => phase),
      }
    };
  };

  const handleCopyAndGemini = async () => {
    const analysisData = generateAnalysisData();
    
    // DEBUG: Log actual actions data - 詳細にチェック
    const actionsCheck = actions.map((action, idx) => ({
      index: idx,
      position: action.position,
      action: action.action,
      opponentType: action.opponentType,
      opponentStyle: action.opponentStyle,
      hasOpponentType: !!action.opponentType,
      hasOpponentStyle: !!action.opponentStyle,
      isHero: action.position === heroPosition,
      fullAction: action
    }));
    addDebugLog('[ActionLog] handleCopyAndGemini - actions prop CHECK', { 
      actionsCount: actions.length,
      actionsCheck,
      analysisDataActionSequence: analysisData.actionSequence.map(a => ({
        position: a.position,
        opponentType: a.opponentType,
        opponentStyle: a.opponentStyle,
        isHero: a.position === heroPosition
      }))
    });
    
    actions.forEach((action, idx) => {
      if (action.position !== heroPosition) {
        const debugData = {
          index: idx,
          position: action.position,
          action: action.action,
          opponentType: action.opponentType,
          opponentStyle: action.opponentStyle,
          hasOpponentType: !!action.opponentType,
          hasOpponentStyle: !!action.opponentStyle && action.opponentStyle !== 'unknown',
          fullAction: action
        };
        console.log(`[ActionLog] Action ${idx}:`, debugData);
        addDebugLog(`[ActionLog] Action ${idx}`, debugData);
      }
    });
    
    let promptText = `テキサスホールデムポーカーにおける以下の自分の動きをGTOやエクスプロイト戦略に則ってフラットにレビューして

【セッション情報】
ヒーローポジション: ${analysisData.sessionInfo.heroPosition}
ヒーローハンド: ${analysisData.sessionInfo.heroHand}
初期スタック: ${analysisData.sessionInfo.initialStack}bb
現在のスタック: ${analysisData.sessionInfo.currentStack}bb

【ボード情報】
現在のフェーズ: ${analysisData.boardInfo.currentPhase}
ボード: ${analysisData.boardInfo.board}

【アクション詳細】
${analysisData.actionSequence.map((action, idx) => {
  const typeAndStyle: string[] = [];
  if (action.opponentType && action.position !== heroPosition) {
    typeAndStyle.push(action.opponentType);
  }
  if (action.opponentStyle && action.opponentStyle !== 'unknown' && action.position !== heroPosition) {
    typeAndStyle.push(action.opponentStyle);
  }
  const typeStyleStr = typeAndStyle.length > 0 ? ` (${typeAndStyle.join(', ')})` : '';
      // DEBUG: Log each formatted action
      const geminiDebugData = {
        index: idx + 1,
        position: action.position,
        action: action.action,
        opponentType: action.opponentType,
        opponentStyle: action.opponentStyle,
        typeStyleStr,
        formatted: `${idx + 1}. [${action.phase}] ${action.position}: ${action.action}${action.betSize ? ` ${action.betSize.toFixed(1)}bb` : ''}${typeStyleStr}`
      };
      console.log(`[ActionLog] Gemini action ${idx + 1}:`, geminiDebugData);
      addDebugLog(`[ActionLog] Gemini action ${idx + 1}`, geminiDebugData);
  return `${idx + 1}. [${action.phase}] ${action.position}: ${action.action}${action.betSize ? ` ${action.betSize.toFixed(1)}bb` : ''}${typeStyleStr}`;
}).join('\n')}

【ポット情報】
最終ポット: ${analysisData.potInfo.finalPot}bb`;

    // Add result information if available
    if (analysisData.result) {
      promptText += `

【ハンド結果】
完了タイプ: ${analysisData.result.completionType}
勝者: ${analysisData.result.winner}
ヒーローの結果: ${analysisData.result.heroWon ? '勝利' : '敗北'}
獲得/損失: ${analysisData.result.potAwarded > 0 ? '+' : ''}${analysisData.result.potAwarded.toFixed(1)}bb

【ショーダウン情報】
${analysisData.result.showdownHands.map(p => 
  `${p.position}: ${p.hand}${p.isWinner ? ' (Winner)' : ''}`
).join('\n')}`;
    }

    promptText += `

【サマリー】
総アクション数: ${analysisData.summary.totalActions}
ヒーローアクション数: ${analysisData.summary.heroActions}
進行フェーズ: ${analysisData.summary.phases.join(' → ')}`;
    
    try {
      await navigator.clipboard.writeText(promptText);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
      
      // Geminiを新しいタブで開く
      window.open('https://gemini.google.com/app', '_blank');
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const groupedActions = groupActionsByPhase();
  const hasActions = actions.length > 0;
  const stackInfo = calculateStackInfo();

  return (
    <div className="h-full bg-gray-950 px-2 py-1 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-1 flex-shrink-0">
        <h2 className="text-[10px] font-semibold text-gray-400">Action Log</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 rounded text-[9px] font-semibold transition-colors"
            title="Show Debug Panel"
          >
            DEBUG
          </button>
          {hasActions && (
            <button
              onClick={handleCopyAndGemini}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-600 hover:bg-purple-700 rounded text-[10px] font-semibold transition-colors"
              title="Copy to clipboard and open Gemini"
            >
              {copyStatus === 'copied' ? (
                <>
                  <Copy className="w-2.5 h-2.5" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>Copy & Gemini</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {hasActions ? (
          <div className="space-y-0 leading-tight">
            {/* セッション情報 */}
            <div className="pb-0.5 border-b border-gray-800 mb-0.5 space-y-0">
              <div className="text-[9px] font-mono leading-tight">
                <span className="text-purple-400 font-semibold">Hero:</span>{' '}
                <span className="text-gray-300">{heroPosition || 'Not set'}</span>
                {heroHand && (
                  <>
                    {' | '}
                    <span className="text-yellow-400 font-semibold">{heroHand[0]}{heroHand[1]}</span>
                  </>
                )}
              </div>
              <div className="text-[9px] font-mono leading-tight">
                <span className="text-blue-400 font-semibold">Stack:</span>{' '}
                <span className="text-gray-300">{stackInfo.initialStack}bb</span>
                {stackInfo.currentStack !== stackInfo.initialStack && (
                  <>
                    {' → '}
                    <span className="text-orange-400">{stackInfo.currentStack.toFixed(1)}bb</span>
                  </>
                )}
              </div>
              {Object.keys(board).length > 0 && currentPhase !== 'Preflop' && (
                <div className="text-[9px] font-mono leading-tight">
                  <span className="text-green-400 font-semibold">Board:</span>{' '}
                  <span className="text-gray-300">{formatBoard()}</span>
                </div>
              )}
            </div>

            {/* フェーズごとのアクション */}
            {(Object.keys(groupedActions) as Phase[]).map((phase) => {
              const phaseActions = groupedActions[phase];
              if (phaseActions.length === 0) return null;

              // DEBUG: Show action metadata in UI
              const debugInfo = phaseActions.map(a => ({
                pos: a.position,
                act: a.action,
                type: a.opponentType,
                style: a.opponentStyle,
                hasType: !!a.opponentType,
                hasStyle: !!a.opponentStyle && a.opponentStyle !== 'unknown'
              }));

              return (
                <div key={phase} className="text-[9px] font-mono leading-tight">
                  <span className="text-blue-400 font-semibold">{phase}:</span>{' '}
                  <span className="text-gray-300">{formatPhaseActions(phaseActions)}</span>
                  {/* DEBUG: Show metadata */}
                  {process.env.NODE_ENV === 'development' && (
                    <span className="text-red-400 text-[7px] ml-1" title={JSON.stringify(debugInfo, null, 2)}>
                      [DBG]
                    </span>
                  )}
                </div>
              );
            })}
            
            {/* ポット情報 */}
            <div className="pt-0.5 border-t border-gray-800 mt-0.5">
              <span className="text-[9px] font-mono leading-tight">
                <span className="text-gray-400">Pot:</span>{' '}
                <span className="text-green-400 font-semibold">{potSize.toFixed(1)}bb</span>
              </span>
            </div>

            {/* 結果情報 */}
            {result && (
              <div className="pt-0.5 border-t border-gray-800 mt-0.5 space-y-0">
                <div className="text-[9px] font-mono leading-tight">
                  <span className="text-purple-400 font-semibold">Result:</span>{' '}
                  <span className={result.heroWon ? 'text-green-400' : 'text-red-400'}>
                    {result.heroWon ? 'Won' : 'Lost'}
                  </span>
                  {' | '}
                  <span className="text-yellow-400 font-semibold">
                    {result.potAwarded > 0 ? '+' : ''}{result.potAwarded.toFixed(1)}bb
                  </span>
                </div>
                <div className="text-[9px] font-mono leading-tight">
                  <span className="text-blue-400 font-semibold">Winner:</span>{' '}
                  <span className="text-gray-300">{result.winner}</span>
                </div>
                {result.showdownHands.length > 0 && (
                  <div className="text-[9px] font-mono space-y-0 leading-tight">
                    <span className="text-blue-400 font-semibold">Players:</span>
                    {result.showdownHands.map((player, idx) => {
                      // Determine display based on hand and mucked status
                      let displayText: string;
                      let colorClass: string;
                      
                      // 勝者は常にハンドを表示（Muckedしない）
                      if (player.isWinner) {
                        displayText = player.hand ? `${player.hand[0]}${player.hand[1]}` : 'Winner';
                        colorClass = 'text-yellow-300';
                      } else if (player.hand) {
                        // Hand shown
                        displayText = `${player.hand[0]}${player.hand[1]}`;
                        colorClass = 'text-gray-300';
                      } else if (player.mucked) {
                        // Reached river but mucked
                        displayText = 'Mucked';
                        colorClass = 'text-orange-400';
                      } else {
                        // Folded earlier (before showdown)
                        displayText = 'Folded';
                        colorClass = 'text-gray-500';
                      }
                      
                      return (
                        <div key={idx} className="ml-2">
                          <span className="text-gray-400">{player.position}:</span>{' '}
                          <span className={colorClass}>
                            {displayText}
                          </span>
                          {player.isWinner && (
                            <span className="text-yellow-400 ml-1">★</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[9px] text-gray-500 italic leading-tight">
            No actions recorded yet
          </div>
        )}
      </div>
      
      {/* Debug Panel */}
      {showDebugPanel && (
        <div className="absolute inset-0 bg-black/95 z-50 overflow-y-auto p-2 text-[8px] font-mono">
          <div className="flex items-center justify-between mb-2 sticky top-0 bg-black pb-2">
            <h3 className="text-[10px] font-bold text-red-400">Debug Logs & Current Actions</h3>
            <button
              onClick={() => setShowDebugPanel(false)}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-[9px]"
            >
              Close
            </button>
          </div>
          
          {/* Current Actions Check */}
          <div className="mb-4 p-2 bg-gray-900 rounded border border-yellow-600">
            <div className="text-yellow-400 font-bold mb-1">Current Actions Prop (count: {actions.length})</div>
            {actions.map((action, idx) => (
              <div key={idx} className="text-[7px] text-gray-300 mb-1">
                [{idx}] {action.position} {action.action} | Type: {action.opponentType || 'undefined'} | Style: {action.opponentStyle || 'undefined'}
              </div>
            ))}
          </div>
          
          <div className="space-y-1">
            {getDebugLogs().slice(-30).map((log: any, idx: number) => (
              <div key={idx} className="border-b border-gray-700 pb-1">
                <div className="text-yellow-400 font-semibold">{log.source}</div>
                <pre className="text-gray-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto text-[7px]">
                  {JSON.stringify(log.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
