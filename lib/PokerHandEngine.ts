import type { Position, ActionType, Phase, HandAction, PokerHand, HandResult, CompletionType, OpponentType, OpponentStyle } from '@/types/poker';
import { addDebugLog } from './debugLogger';

/**
 * ポーカーロジックエンジン（6-max専用）
 * - プリフロップの爆速入力（スキップ機能）
 * - ポストフロップの自動進行
 * - ポット計算、スタック管理
 */

// ポジション順序（時計回り）
export const POSITION_ORDER: Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];

// プリフロップの開始位置（UTG）
const PREFLOP_START_INDEX = 2; // UTG

// UUID生成ヘルパー
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * プレイヤー情報
 */
interface PlayerState {
  position: Position;
  stack: number; // 残りスタック（BB単位）
  contributed: number; // 現在のストリートで投入した額
  totalContributed: number; // ハンド全体で投入した額
  folded: boolean;
  isHero: boolean;
  hasActedThisStreet: boolean; // このストリートでアクション済みか
}

/**
 * ストリート情報
 */
interface StreetState {
  phase: Phase;
  pot: number; // 現在のポット
  streetStartingPot: number; // このストリート開始時のポット
  currentBet: number; // 現在のベット額（このストリートで）
  lastAggressorIndex: number | null; // 最後にBet/Raiseしたプレイヤーのインデックス
  actionsThisStreet: HandAction[]; // このストリートのアクション
  raiseCount: number; // このストリートでのレイズ回数（プリフロップ: Open=1, 3bet=2, 4bet=3）
}

export class PokerHandEngine {
  private players: PlayerState[];
  private street: StreetState;
  private actions: HandAction[]; // 全アクション履歴
  private heroPosition: Position | null;
  private stackSize: number;
  private currentActorIndex: number; // 現在の手番プレイヤー
  private waitingForBoard: boolean; // ボード入力待ちフラグ
  private handResult: HandResult | null; // ハンド結果情報

  constructor(heroPosition: Position | null, stackSize: number = 100) {
    this.heroPosition = heroPosition;
    this.stackSize = stackSize;
    this.actions = [];
    this.waitingForBoard = false;
    this.handResult = null;

    // 初期プレイヤー状態
    this.players = POSITION_ORDER.map((pos) => ({
      position: pos,
      stack: stackSize,
      contributed: 0,
      totalContributed: 0,
      folded: false,
      isHero: pos === heroPosition,
      hasActedThisStreet: false,
    }));

    // ブラインド投入
    const sbIndex = this.getPlayerIndex('SB');
    const bbIndex = this.getPlayerIndex('BB');
    this.players[sbIndex].contributed = 0.5;
    this.players[sbIndex].totalContributed = 0.5;
    this.players[sbIndex].stack -= 0.5;
    this.players[bbIndex].contributed = 1.0;
    this.players[bbIndex].totalContributed = 1.0;
    this.players[bbIndex].stack -= 1.0;

    // 初期ストリート状態（Preflop）
    this.street = {
      phase: 'Preflop',
      pot: 1.5, // SB + BB
      streetStartingPot: 1.5, // プリフロップ開始時のポット
      currentBet: 1.0, // BB
      lastAggressorIndex: null,
      actionsThisStreet: [],
      raiseCount: 0, // BBはブラインドなのでカウントしない
    };

    // プリフロップはUTGから開始
    this.currentActorIndex = PREFLOP_START_INDEX;
  }

  /**
   * ポジションからプレイヤーインデックスを取得
   */
  private getPlayerIndex(position: Position): number {
    return POSITION_ORDER.indexOf(position);
  }

  /**
   * 現在の手番のポジションを取得
   */
  getCurrentActor(): Position | null {
    if (this.isHandComplete() || this.waitingForBoard) return null;
    return POSITION_ORDER[this.currentActorIndex];
  }

  /**
   * 次の有効なプレイヤーを取得（フォールド済み・オールイン済みをスキップ）
   */
  private getNextActivePlayerIndex(startIndex: number): number {
    for (let i = 1; i <= 6; i++) {
      const idx = (startIndex + i) % 6;
      const player = this.players[idx];
      // フォールド済みまたはオールイン済み（スタック0）のプレイヤーをスキップ
      if (!player.folded && player.stack > 0.01) {
        return idx;
      }
    }
    return -1; // 全員フォールドまたはオールイン
  }

  /**
   * アクティブなプレイヤー数を取得
   */
  private getActivePlayerCount(): number {
    return this.players.filter(p => !p.folded).length;
  }

  /**
   * チェックが可能か判定
   */
  canCheck(position: Position): boolean {
    const player = this.players[this.getPlayerIndex(position)];
    if (player.folded) return false;
    
    // 現在のベット額に既にマッチしているか、ベットがない場合はチェック可能
    return player.contributed >= this.street.currentBet;
  }

  /**
   * コールが必要か判定
   */
  needsToCall(position: Position): boolean {
    const player = this.players[this.getPlayerIndex(position)];
    if (player.folded) return false;
    
    return player.contributed < this.street.currentBet;
  }

  /**
   * 利用可能なアクションを取得
   */
  getAvailableActions(position: Position): ActionType[] {
    const player = this.players[this.getPlayerIndex(position)];
    if (player.folded) return [];
    
    const actions: ActionType[] = [];
    
    if (this.canCheck(position)) {
      // チェック可能な場合
      actions.push('Check');
      
      // ポストフロップでベットがない場合は「Bet」
      // プリフロップまたはベットがある場合は「Raise」
      if (this.street.phase !== 'Preflop' && this.street.currentBet === 0) {
        actions.push('Bet');
      } else {
        actions.push('Raise');
      }
    } else {
      // コールが必要な場合
      actions.push('Fold');
      actions.push('Call');
      actions.push('Raise');
    }
    
    return actions;
  }

  /**
   * プリフロップのスキップ機能付きアクション
   * @param position アクションするポジション
   * @param actionType アクションタイプ
   * @param betSize ベット/レイズのサイズ（BB単位）
   * @param opponentType オポーネントタイプ（オプション）
   * @param opponentStyle オポーネントスタイル（オプション）
   */
  addPreflopAction(position: Position, actionType: ActionType, betSize?: number, opponentType?: OpponentType, opponentStyle?: OpponentStyle): void {
    if (this.street.phase !== 'Preflop') {
      throw new Error('This method is only for preflop actions');
    }

    const actorIndex = this.getPlayerIndex(position);
    const currentIndex = this.currentActorIndex;

    // スキップ機能: currentIndexからactorIndexまでの間のプレイヤーは全員Fold
    if (actorIndex !== currentIndex) {
      this.autoFoldBetween(currentIndex, actorIndex);
    }

    // 実際のアクションを記録
    this.recordAction(position, actionType, betSize, opponentType, opponentStyle);

    // 次の手番を決定
    this.advanceToNextActor();
  }

  /**
   * 指定範囲のプレイヤーを自動的にFoldさせる
   * @param startIndex 開始インデックス（この位置も含む）
   * @param endIndex 終了インデックス（この位置は含まない）
   */
  private autoFoldBetween(startIndex: number, endIndex: number): void {
    let idx = startIndex;
    while (idx !== endIndex) {
      if (!this.players[idx].folded) {
        this.recordAction(POSITION_ORDER[idx], 'Fold', undefined, undefined, undefined);
      }
      idx = this.getNextActivePlayerIndex(idx);
      if (idx === -1) break;
    }
  }

  /**
   * ポストフロップのアクション
   * @param position アクションするポジション
   * @param actionType アクションタイプ
   * @param betSize ベット/レイズのサイズ（BB単位）
   * @param opponentType オポーネントタイプ（オプション）
   * @param opponentStyle オポーネントスタイル（オプション）
   */
  addPostflopAction(position: Position, actionType: ActionType, betSize?: number, opponentType?: OpponentType, opponentStyle?: OpponentStyle): void {
    if (this.street.phase === 'Preflop') {
      throw new Error('Use addPreflopAction for preflop');
    }

    const actorIndex = this.getPlayerIndex(position);
    if (actorIndex !== this.currentActorIndex) {
      throw new Error(`It's not ${position}'s turn. Current actor: ${this.getCurrentActor()}`);
    }

    this.recordAction(position, actionType, betSize, opponentType, opponentStyle);
    this.advanceToNextActor();
  }

  /**
   * アクションを記録
   * @param position アクションするポジション
   * @param actionType アクションタイプ
   * @param betSize ベット/レイズのサイズ（BB単位）
   * @param opponentType オポーネントタイプ（オプション）
   * @param opponentStyle オポーネントスタイル（オプション）
   */
  private recordAction(position: Position, actionType: ActionType, betSize?: number, opponentType?: OpponentType, opponentStyle?: OpponentStyle): void {
    // DEBUG: PokerHandEngine recordAction
    addDebugLog('[PokerHandEngine] recordAction called', {
      position,
      actionType,
      betSize,
      opponentType,
      opponentStyle
    });
    
    const playerIndex = this.getPlayerIndex(position);
    const player = this.players[playerIndex];

    if (player.folded) {
      throw new Error(`${position} has already folded`);
    }

    let actualBetSize = betSize;
    let amountToAdd = 0;

    switch (actionType) {
      case 'Fold':
        player.folded = true;
        break;

      case 'Check':
        // チェック可能かを検証
        if (player.contributed < this.street.currentBet) {
          throw new Error('Cannot check when there is a bet to call');
        }
        break;

      case 'Call': {
        const callAmount = this.street.currentBet - player.contributed;
        if (callAmount <= 0) {
          throw new Error('Nothing to call');
        }
        const actualCall = Math.min(callAmount, player.stack);
        amountToAdd = actualCall;
        player.stack -= actualCall;
        player.contributed += actualCall;
        player.totalContributed += actualCall;
        actualBetSize = actualCall;
        break;
      }

      case 'Bet':
        if (this.street.currentBet > 0) {
          throw new Error('Cannot bet when there is already a bet (use Raise)');
        }
        if (!betSize || betSize <= 0) {
          throw new Error('Bet size must be positive');
        }
        actualBetSize = Math.min(betSize, player.stack);
        amountToAdd = actualBetSize;
        player.stack -= actualBetSize;
        player.contributed += actualBetSize;
        player.totalContributed += actualBetSize;
        this.street.currentBet = player.contributed;
        this.street.lastAggressorIndex = playerIndex;
        this.street.raiseCount += 1;
        break;

      case 'Raise': {
        if (!betSize || betSize <= 0) {
          throw new Error('Raise size must be positive');
        }
        // レイズの場合、betSizeはトータル額（コール分を含む）
        const raiseTotal = Math.min(betSize, player.stack + player.contributed);
        const additionalAmount = raiseTotal - player.contributed;
        amountToAdd = additionalAmount;
        player.stack -= additionalAmount;
        player.contributed = raiseTotal;
        player.totalContributed += additionalAmount;
        this.street.currentBet = player.contributed;
        this.street.lastAggressorIndex = playerIndex;
        this.street.raiseCount += 1;
        actualBetSize = additionalAmount;
        break;
      }
    }

    // アクション済みマークを付ける
    player.hasActedThisStreet = true;

    // ポットに追加
    this.street.pot += amountToAdd;

    // アクション履歴に記録
    const action: HandAction = {
      id: generateUUID(),
      position,
      action: actionType,
      betSize: actualBetSize,
      potSize: this.street.pot,
      timestamp: Date.now(),
      phase: this.street.phase,
      opponentType,
      opponentStyle,
    };

    // DEBUG: PokerHandEngine recordAction - action created
    addDebugLog('[PokerHandEngine] recordAction - action created', {
      actionId: action.id,
      position: action.position,
      action: action.action,
      betSize: action.betSize,
      opponentType: action.opponentType,
      opponentStyle: action.opponentStyle,
      actionObject: action
    });

    this.street.actionsThisStreet.push(action);
    this.actions.push(action);
    
    // DEBUG: Verify action was stored
    const lastStored = this.actions[this.actions.length - 1];
    addDebugLog('[PokerHandEngine] recordAction - last stored action', {
      actionId: lastStored.id,
      opponentType: lastStored.opponentType,
      opponentStyle: lastStored.opponentStyle,
      allActionsLength: this.actions.length
    });
  }

  /**
   * 次のアクターに進む（ストリート終了判定も含む）
   */
  private advanceToNextActor(): void {
    // アクティブなプレイヤーが1人以下ならハンド終了
    if (this.getActivePlayerCount() <= 1) {
      this.currentActorIndex = -1;
      return;
    }

    const nextIndex = this.getNextActivePlayerIndex(this.currentActorIndex);
    
    // nextIndexが-1の場合（アクション可能なプレイヤーがいない場合）でも、
    // ストリート終了判定をチェックする必要がある（全員オールインの可能性）
    let checkIndex = nextIndex;
    if (checkIndex === -1) {
      // アクション可能なプレイヤーがいない場合、現在のアクターのインデックスを使用
      // （実際には次のストリートへ進むべきなので、適当な値を使用）
      checkIndex = this.currentActorIndex;
    }

    // ストリート終了判定
    if (this.isStreetComplete(checkIndex)) {
      // リバー終了ならハンド終了
      if (this.street.phase === 'River') {
        this.currentActorIndex = -1;
        // リバー完了フラグを設定（getStateでisCompleteを判定するため）
        return;
      }
      
      // 次のストリートへ（ボード入力を待つ）
      this.waitingForBoard = true;
      this.prepareNextStreet();
    } else {
      if (nextIndex === -1) {
        // アクション可能なプレイヤーがいないが、ストリートが完了していない場合
        // これは通常起こらないが、念のためハンド終了とする
        this.currentActorIndex = -1;
        return;
      }
      this.currentActorIndex = nextIndex;
    }
  }

  /**
   * ストリートが完了したかをチェック
   * @param nextIndex 次の手番予定のプレイヤー
   */
  private isStreetComplete(nextIndex: number): boolean {
    const activePlayers = this.players.filter(p => !p.folded);
    const activeCount = activePlayers.length;
    
    // 全員がフォールドしている場合は完了
    if (activeCount <= 1) {
      return true;
    }

    // アクション可能なプレイヤー（スタック0でない）を取得
    const playersWhoCanAct = activePlayers.filter(p => p.stack > 0.01);
    
    // アクション可能なプレイヤーがいない場合（全員オールイン）は完了
    if (playersWhoCanAct.length === 0) {
      return true;
    }

    // アクション可能なプレイヤー全員がアクション済みかチェック
    const allActablePlayersActed = playersWhoCanAct.every(p => p.hasActedThisStreet);
    
    if (!allActablePlayersActed) {
      return false;
    }

    // 全アクティブプレイヤーが同額を出しているか（またはオールイン済み）
    // オールイン済み（スタック0）のプレイヤーは既にマッチしているとみなす
    const allMatched = activePlayers.every(p => 
      p.contributed >= this.street.currentBet || p.stack < 0.01
    );

    if (!allMatched) {
      return false;
    }

    // プリフロップの特殊ケース：BBオプション
    if (this.street.phase === 'Preflop') {
      const bbIndex = this.getPlayerIndex('BB');
      const bbPlayer = this.players[bbIndex];
      
      // BBがまだフォールドしておらず、誰もレイズしていない場合
      // （全員リンプ/コールした場合）
      if (!bbPlayer.folded && this.street.raiseCount === 0) {
        // BBがまだアクションしていなければ、BBのオプションがある
        if (!bbPlayer.hasActedThisStreet) {
          return false;
        }
      }
      
      // レイズがあった場合、最後のアグレッサーに手番が戻ってきたら終了
      if (this.street.lastAggressorIndex !== null && nextIndex === this.street.lastAggressorIndex) {
        return true;
      }
    } else {
      // ポストフロップ：最後のアグレッサーに手番が戻ってきたら終了
      if (this.street.lastAggressorIndex !== null && nextIndex !== -1 && nextIndex === this.street.lastAggressorIndex) {
        return true;
      }
    }

    // nextIndexが-1の場合（全員オールイン）、ストリートは完了
    if (nextIndex === -1) {
      return true;
    }

    // 全員アクション済みで全員同額（チェックチェック含む）
    return true;
  }

  /**
   * 次のストリートの準備（実際の移行はconfirmBoardで行う）
   */
  private prepareNextStreet(): void {
    // プレイヤーの貢献額とアクション済みフラグをリセット
    this.players.forEach(p => {
      p.contributed = 0;
      p.hasActedThisStreet = false;
    });

    // 次のフェーズを決定
    const phaseOrder: Phase[] = ['Preflop', 'Flop', 'Turn', 'River'];
    const currentPhaseIndex = phaseOrder.indexOf(this.street.phase);
    const nextPhase = phaseOrder[currentPhaseIndex + 1];
    
    this.street.phase = nextPhase;
    this.street.streetStartingPot = this.street.pot;
    this.street.currentBet = 0;
    this.street.lastAggressorIndex = null;
    this.street.actionsThisStreet = [];
    this.street.raiseCount = 0;

    // ポストフロップの最初のアクターを設定
    this.setPostflopFirstActor();
  }

  /**
   * ポストフロップの最初のアクターを設定
   */
  private setPostflopFirstActor(): void {
    // ディーラーの左（SB）から開始
    // SBが生存していて、スタックがある場合はSB
    // そうでなければ次のアクティブプレイヤー（スタック0はスキップ）
    const sbIndex = this.getPlayerIndex('SB');
    const sbPlayer = this.players[sbIndex];
    
    if (!sbPlayer.folded && sbPlayer.stack > 0.01) {
      this.currentActorIndex = sbIndex;
      return;
    }
    
    // SBの次のアクティブプレイヤー（オールイン済みはスキップ）
    const nextIndex = this.getNextActivePlayerIndex(sbIndex);
    if (nextIndex === -1) {
      // これは全員オールインの場合なので、すでに上で処理済み
      this.currentActorIndex = -1;
      // Riverでも、まだボードカードが選ばれていない場合は待つ
      // River完了後はハンド完了になる（advanceToNextActorで処理される）
      this.waitingForBoard = true;
    } else {
      this.currentActorIndex = nextIndex;
    }
  }

  /**
   * ボード入力を確認して次のストリートへ移行
   */
  confirmBoard(): void {
    // 全員オールインかどうかを確認
    const playersWhoCanAct = this.players.filter(p => !p.folded && p.stack > 0.01);
    
    // Riverの場合の特別処理（waitingForBoardの状態に関係なく処理する）
    if (this.street.phase === 'River') {
      // Riverのボードカードを選んだ後、全員オールインならハンド完了
      if (playersWhoCanAct.length === 0) {
        // 全員オールインの場合、ハンド完了
        this.currentActorIndex = -1;
        this.waitingForBoard = false;
        return;
      }
      // 全員オールインでない場合、Riverのアクションを開始
      this.waitingForBoard = false;
      return;
    }
    
    // Flop/Turnの場合、waitingForBoardがfalseの場合は処理しない
    if (!this.waitingForBoard) {
      return;
    }
    
    this.waitingForBoard = false;
    
    // 全員オールインの場合でも、次のストリートのボードカードを入力する必要がある
    // そのため、次のストリートへ進むだけにする（prepareNextStreetを呼び、waitingForBoardをtrueにする）
    if (playersWhoCanAct.length === 0) {
      // 全員オールインの場合、次のストリートへ進む
      // 現在のフェーズを確認してから進む
      const currentPhase = this.street.phase;
      
      if (currentPhase === 'Turn') {
        // Turn完了後、Riverへ
        this.prepareNextStreet();
        // Riverのボードカード入力待ち
        this.waitingForBoard = true;
        return;
      } else if (currentPhase === 'Flop') {
        // Flop完了後、Turnへ（Turnのボードカード入力待ち）
        this.prepareNextStreet();
        this.waitingForBoard = true;
        return;
      }
    }
  }

  /**
   * ボード入力待ちかどうか
   */
  isWaitingForBoard(): boolean {
    return this.waitingForBoard;
  }

  /**
   * 次のストリートへ進む（旧API互換のため維持）
   */
  private advanceToNextStreet(): void {
    if (this.waitingForBoard) {
      this.confirmBoard();
    }
  }

  /**
   * ハンドが完了したか
   */
  isHandComplete(): boolean {
    if (this.getActivePlayerCount() <= 1) {
      return true;
    }
    if (this.currentActorIndex === -1 && !this.waitingForBoard) {
      return true;
    }
    return false;
  }

  /**
   * 現在のストリートが完了したか（次のストリートへ進めるか）
   */
  canAdvanceStreet(): boolean {
    return this.waitingForBoard;
  }

  /**
   * 手動でストリートを進める（ボード入力後など）
   */
  forceAdvanceToNextStreet(): void {
    if (this.waitingForBoard) {
      this.confirmBoard();
    }
  }

  /**
   * 現在の状態を取得
   */
  getState(): {
    players: PlayerState[];
    pot: number;
    phase: Phase;
    currentActor: Position | null;
    actions: HandAction[];
    isComplete: boolean;
    currentBet: number;
    waitingForBoard: boolean;
  } {
    // DEBUG: Log this.actions before returning
    addDebugLog('[PokerHandEngine] getState - this.actions before return', {
      actionsCount: this.actions.length,
      actions: this.actions.map(a => ({
        position: a.position,
        action: a.action,
        opponentType: a.opponentType,
        opponentStyle: a.opponentStyle,
        hasOpponentType: !!a.opponentType,
        hasOpponentStyle: !!a.opponentStyle
      }))
    });
    
    const actionsCopy = [...this.actions];
    // DEBUG: Verify copy has same values
    if (actionsCopy.length > 0) {
      const lastAction = actionsCopy[actionsCopy.length - 1];
      addDebugLog('[PokerHandEngine] getState - actions copy verification', {
        lastActionPosition: lastAction.position,
        lastActionOpponentType: lastAction.opponentType,
        lastActionOpponentStyle: lastAction.opponentStyle,
        isSameReference: lastAction === this.actions[this.actions.length - 1]
      });
    }
    
    return {
      players: this.players.map(p => ({ ...p })),
      pot: this.street.pot,
      phase: this.street.phase,
      currentActor: this.getCurrentActor(),
      actions: actionsCopy,
      isComplete: this.isHandComplete(),
      currentBet: this.street.currentBet,
      waitingForBoard: this.waitingForBoard,
    };
  }

  /**
   * 現在のポット額を取得
   */
  getPot(): number {
    return this.street.pot;
  }

  /**
   * ポットの詳細情報を取得
   */
  getPotDetails(): { startingPot: number; addedThisStreet: number; totalPot: number } {
    return {
      startingPot: this.street.streetStartingPot,
      addedThisStreet: this.street.pot - this.street.streetStartingPot,
      totalPot: this.street.pot,
    };
  }

  /**
   * 現在のフェーズを取得
   */
  getPhase(): Phase {
    return this.street.phase;
  }

  /**
   * 現在のベット額を取得
   */
  getCurrentBet(): number {
    return this.street.currentBet;
  }

  /**
   * 現在のレイズカウントを取得
   */
  getRaiseCount(): number {
    return this.street.raiseCount;
  }

  /**
   * レイズアクションのラベルを取得（Open, 3-bet, 4-bet, Bet, Raise, Re-raise）
   */
  getRaiseLabel(): string {
    if (this.street.phase === 'Preflop') {
      if (this.street.raiseCount === 0) return 'Open';
      if (this.street.raiseCount === 1) return '3-bet';
      if (this.street.raiseCount === 2) return '4-bet';
      return `${this.street.raiseCount + 2}-bet`;
    } else {
      if (this.street.currentBet === 0) return 'Bet';
      if (this.street.raiseCount === 1) return 'Raise';
      return 'Re-raise';
    }
  }

  /**
   * 全アクション履歴を取得
   */
  getActions(): HandAction[] {
    return [...this.actions];
  }

  /**
   * PokerHand形式でエクスポート（既存のUIとの互換性）
   */
  exportToPokerHand(): Partial<PokerHand> {
    return {
      actions: this.actions,
      potSize: this.street.pot,
      currentPhase: this.street.phase,
      stackSize: this.stackSize,
      heroPosition: this.heroPosition,
    };
  }

  /**
   * ハンド結果を設定
   */
  setHandResult(result: HandResult): void {
    if (!this.isHandComplete()) {
      throw new Error('Cannot set result for incomplete hand');
    }
    this.handResult = result;
  }

  /**
   * ハンド結果を取得
   */
  getHandResult(): HandResult | null {
    return this.handResult ? { ...this.handResult } : null;
  }

  /**
   * 結果入力が可能かを判定
   */
  isReadyForResult(): boolean {
    // ハンド完了していて、まだ結果が入力されていない場合
    return this.isHandComplete() && this.handResult === null;
  }

  /**
   * 完了タイプを取得
   */
  getCompletionType(): CompletionType {
    const activePlayers = this.players.filter(p => !p.folded);
    
    // 1人だけ残った場合はフォールド完了
    if (activePlayers.length === 1) {
      return 'fold';
    }
    
    // 全員オールインかチェック
    const playersWhoCanAct = activePlayers.filter(p => p.stack > 0.01);
    if (playersWhoCanAct.length === 0) {
      return 'allin';
    }
    
    // それ以外はショーダウン
    return 'showdown';
  }
}
