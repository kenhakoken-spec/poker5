'use client';

import { useState, useCallback, useMemo } from 'react';
import { PokerHandEngine, POSITION_ORDER } from './PokerHandEngine';
import type { Position, ActionType, BoardState, OpponentType, OpponentStyle } from '@/types/poker';
import { addDebugLog } from './debugLogger';

/**
 * ポーカーエンジンを使用するカスタムフック
 */
export function usePokerEngine(heroPosition: Position | null, stackSize: number = 100) {
  const [engine] = useState(() => new PokerHandEngine(heroPosition, stackSize));
  const [, forceUpdate] = useState(0);

  // 強制的に再レンダリング
  const refresh = useCallback(() => {
    forceUpdate(prev => prev + 1);
  }, []);

  // 現在の状態を取得
  const state = engine.getState();

  // プリフロップアクション（スキップ機能付き）
  const addPreflopAction = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number
  ) => {
    engine.addPreflopAction(position, actionType, betSize);
    refresh();
  }, [engine, refresh]);

  // ポストフロップアクション
  const addPostflopAction = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number
  ) => {
    engine.addPostflopAction(position, actionType, betSize);
    refresh();
  }, [engine, refresh]);

  // アクションを追加（フェーズに応じて自動判定）
  const addAction = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number
  ) => {
    if (state.phase === 'Preflop') {
      addPreflopAction(position, actionType, betSize);
    } else {
      addPostflopAction(position, actionType, betSize);
    }
  }, [state.phase, addPreflopAction, addPostflopAction]);

  // ボード入力を確認して次のストリートへ
  const confirmBoard = useCallback(() => {
    engine.confirmBoard();
    refresh();
  }, [engine, refresh]);

  // 次のストリートへ手動で進む（旧API互換）
  const advanceToNextStreet = useCallback(() => {
    engine.forceAdvanceToNextStreet();
    refresh();
  }, [engine, refresh]);

  return {
    engine,
    state,
    addAction,
    addPreflopAction,
    addPostflopAction,
    confirmBoard,
    advanceToNextStreet,
    refresh,
  };
}

/**
 * エンジンと既存のUIの橋渡し用のヘルパー
 */
export interface EnhancedPokerState {
  heroPosition: Position | null;
  heroHand?: [string, string];
  stackSize: number;
  potSize: number;
  potDetails: { startingPot: number; addedThisStreet: number; totalPot: number };
  currentPhase: 'Preflop' | 'Flop' | 'Turn' | 'River';
  currentActor: Position | null;
  currentBet: number;
    actions: Array<{
      id: string;
      position: Position;
      action: ActionType;
      betSize?: number;
      potSize: number;
      timestamp: number;
      phase: 'Preflop' | 'Flop' | 'Turn' | 'River';
      opponentType?: OpponentType;
      opponentStyle?: OpponentStyle;
    }>;
    board: BoardState;
    currentOpponentType: OpponentType;
    currentOpponentStyle: OpponentStyle;
  isComplete: boolean;
  waitingForBoard: boolean;
  availablePositions: Position[];
  availableActions: ActionType[];
  raiseLabel: string; // "Open", "3-bet", "4-bet", "Bet", "Raise", "Re-raise"
  raiseCount: number;
    players: Array<{ position: Position; folded: boolean; isHero: boolean; contributed: number }>;
    result?: HandResult; // Add result
    isReadyForResult: boolean; // Add flag for result input readiness
    completionType?: 'showdown' | 'fold' | 'allin'; // Add completion type
}

/**
 * 既存のPokerHandReducerパターンと互換性を保つラッパー
 */
export function usePokerEngineWithState(initialHeroPosition: Position | null = null, initialStackSize: number = 100) {
  const [heroPosition, setHeroPosition] = useState<Position | null>(initialHeroPosition);
  const [heroHand, setHeroHand] = useState<[string, string] | undefined>();
  const [board, setBoard] = useState<BoardState>({});
  const [currentOpponentType, setCurrentOpponentType] = useState<OpponentType>('Regular');
  const [currentOpponentStyle, setCurrentOpponentStyle] = useState<OpponentStyle>('unknown');
  const [stackSize, setStackSize] = useState(initialStackSize);
  const [resetKey, setResetKey] = useState(0);

  // エンジンを初期化（resetKeyでリセット可能）
  const engine = useMemo(() => new PokerHandEngine(heroPosition, stackSize), [resetKey]);
  const [, forceUpdate] = useState(0);
  
  const refresh = useCallback(() => {
    forceUpdate(prev => prev + 1);
  }, []);

  // 現在の状態を取得
  const state = engine.getState();

  // プリフロップアクション
  const addPreflopAction = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number,
    opponentType?: OpponentType,
    opponentStyle?: OpponentStyle
  ) => {
    engine.addPreflopAction(position, actionType, betSize, opponentType, opponentStyle);
    refresh();
  }, [engine, refresh]);

  // ポストフロップアクション
  const addPostflopAction = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number,
    opponentType?: OpponentType,
    opponentStyle?: OpponentStyle
  ) => {
    engine.addPostflopAction(position, actionType, betSize, opponentType, opponentStyle);
    refresh();
  }, [engine, refresh]);

  // アクションを追加
  const addAction = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number,
    opponentType?: OpponentType,
    opponentStyle?: OpponentStyle
  ) => {
    // DEBUG: usePokerEngine addAction
    const currentPhase = engine.getPhase(); // エンジンから直接フェーズを取得
    addDebugLog('[usePokerEngine] addAction called', {
      position,
      actionType,
      betSize,
      opponentType,
      opponentStyle,
      phase: currentPhase,
      statePhase: state.phase
    });
    
    if (currentPhase === 'Preflop') {
      addPreflopAction(position, actionType, betSize, opponentType, opponentStyle);
    } else {
      addPostflopAction(position, actionType, betSize, opponentType, opponentStyle);
    }
  }, [engine, addPreflopAction, addPostflopAction]);

  // ボード確認
  const confirmBoard = useCallback(() => {
    engine.confirmBoard();
    refresh();
  }, [engine, refresh]);

  // 利用可能なポジションを取得（プリフロップの場合はスキップ機能用）
  const getAvailablePositions = useCallback((): Position[] => {
    if (state.waitingForBoard) return [];
    
    if (state.phase === 'Preflop') {
      // プリフロップ: 現在の手番以降のポジション全て
      const currentActor = state.currentActor;
      if (!currentActor) return [];
      
      const currentIndex = POSITION_ORDER.indexOf(currentActor);
      const available: Position[] = [];
      
      for (let i = 0; i < 6; i++) {
        const idx = (currentIndex + i) % 6;
        const pos = POSITION_ORDER[idx];
        const player = state.players.find(p => p.position === pos);
        if (player && !player.folded) {
          available.push(pos);
        }
      }
      
      return available;
    } else {
      // ポストフロップ: 現在の手番のみ
      return state.currentActor ? [state.currentActor] : [];
    }
  }, [state]);

  // 現在のアクターの利用可能なアクションを取得
  const getAvailableActions = useCallback((): ActionType[] => {
    if (!state.currentActor || state.waitingForBoard) return [];
    return engine.getAvailableActions(state.currentActor);
  }, [engine, state.currentActor, state.waitingForBoard]);

  // アクションを追加（オポーネントタイプとスタイルも記録）
  const addActionWithMetadata = useCallback((
    position: Position,
    actionType: ActionType,
    betSize?: number,
    opponentType?: OpponentType,
    opponentStyle?: OpponentStyle
  ) => {
    // DEBUG: usePokerEngine addActionWithMetadata
    const finalType = opponentType ?? currentOpponentType;
    const finalStyle = opponentStyle ?? currentOpponentStyle;
    addDebugLog('[usePokerEngine] addActionWithMetadata called', {
      position,
      actionType,
      betSize,
      opponentType,
      opponentStyle,
      currentOpponentType,
      currentOpponentStyle,
      finalType,
      finalStyle
    });
    
    // アクションにType/Styleを直接渡す（recordActionで設定される）
    addAction(position, actionType, betSize, finalType, finalStyle);
    
    // 状態も更新（次のアクション用）
    if (opponentType) {
      setCurrentOpponentType(opponentType);
    }
    if (opponentStyle) {
      setCurrentOpponentStyle(opponentStyle);
    }
  }, [addAction, currentOpponentType, currentOpponentStyle]);

  // 統合された状態を返す
  const freshState = engine.getState(); // 最新の状態を取得
  // DEBUG: Log freshState actions
  addDebugLog('[usePokerEngine] enhancedState - freshState.actions', {
    actionsCount: freshState.actions.length,
    actions: freshState.actions.map(a => ({
      position: a.position,
      action: a.action,
      opponentType: a.opponentType,
      opponentStyle: a.opponentStyle
    }))
  });
  const enhancedState: EnhancedPokerState = {
    heroPosition,
    heroHand,
    stackSize,
    potSize: freshState.pot,
    potDetails: engine.getPotDetails(),
    currentPhase: freshState.phase,
    currentActor: freshState.currentActor,
    currentBet: freshState.currentBet,
    actions: freshState.actions, // 最新のアクション配列を使用
    board,
    currentOpponentType,
    currentOpponentStyle,
    isComplete: freshState.isComplete,
    waitingForBoard: freshState.waitingForBoard,
    availablePositions: getAvailablePositions(),
    availableActions: getAvailableActions(),
    raiseLabel: engine.getRaiseLabel(),
    raiseCount: engine.getRaiseCount(),
    players: freshState.players.map(p => ({ 
      position: p.position, 
      folded: p.folded, 
      isHero: p.isHero,
      contributed: p.contributed,
    })),
    result: engine.getHandResult() || undefined,
    isReadyForResult: engine.isReadyForResult(),
    completionType: freshState.isComplete ? engine.getCompletionType() : undefined,
  };

  return {
    state: enhancedState,
    setHeroPosition: (pos: Position | null) => {
      setHeroPosition(pos);
      refresh();
    },
    setHeroHand,
    setBoard: (newBoard: BoardState) => {
      setBoard(newBoard);
      // ボードが設定されたら、エンジンにボード入力完了を通知
      // ただし、新しいカードが追加された場合のみ
      const oldKeys = Object.keys(board).length;
      const newKeys = Object.keys(newBoard).length;
      if (newKeys > oldKeys && state.waitingForBoard) {
        confirmBoard();
      }
    },
    setCurrentOpponentType,
    setCurrentOpponentStyle,
    setStackSize,
    addAction: addActionWithMetadata,
    setHandResult: (result: HandResult) => {
      engine.setHandResult(result);
      refresh();
    },
    reset: () => {
      // エンジンをリセット
      setHeroPosition(null);
      setHeroHand(undefined);
      setBoard({});
      setCurrentOpponentType('Regular');
      setCurrentOpponentStyle('unknown');
      setResetKey(prev => prev + 1);
    },
  };
}
