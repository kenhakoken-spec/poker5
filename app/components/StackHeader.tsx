'use client';

import { HandPicker } from './HandPicker';
import type { Position } from '@/types/poker';

interface StackHeaderProps {
  stackSize: number;
  heroPosition: Position | null;
  heroHand?: [string, string];
  onStackSizeChange: (size: number) => void;
  onHandChange: (hand: [string, string]) => void;
}

export function StackHeader({ stackSize, heroPosition, heroHand, onStackSizeChange, onHandChange }: StackHeaderProps) {
  const handleQuickAdjust = (delta: number) => {
    const newSize = Math.max(10, stackSize + delta);
    onStackSizeChange(newSize);
  };

  return (
    <div className="px-3 py-2 bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-gray-400">Stack</label>
            <input
              type="number"
              value={stackSize}
              onChange={(e) => onStackSizeChange(Number(e.target.value))}
              className="w-16 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-white text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
              step="10"
              min="10"
            />
            <span className="text-[10px] text-gray-400">bb</span>
            <div className="flex flex-col">
              <button
                onClick={() => handleQuickAdjust(10)}
                className="w-4 h-3 flex items-center justify-center text-[10px] text-gray-300 hover:text-white transition-colors active:scale-95"
                aria-label="Increase stack by 10bb"
              >
                ▲
              </button>
              <button
                onClick={() => handleQuickAdjust(-10)}
                className="w-4 h-3 flex items-center justify-center text-[10px] text-gray-300 hover:text-white transition-colors active:scale-95"
                aria-label="Decrease stack by 10bb"
              >
                ▽
              </button>
            </div>
          </div>
          
          {heroPosition && (
            <div className="px-2 py-0.5 bg-yellow-900/30 border border-yellow-700/50 rounded">
              <span className="text-[10px] text-gray-400">Hero: </span>
              <span className="text-xs font-semibold text-yellow-400">{heroPosition}</span>
            </div>
          )}
        </div>

        {/* ハンド入力ボタン */}
        <HandPicker
          hand={heroHand}
          onHandChange={onHandChange}
        />
      </div>
    </div>
  );
}
