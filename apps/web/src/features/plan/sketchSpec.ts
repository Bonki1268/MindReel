import type { Shot } from '@templeyard/shared';

// 分鏡的手繪稿（構圖示意）：依景別、運鏡、場景視角與角色數量，決定要畫什麼。
// 這是規則畫出來的示意圖，不是 AI 生成的圖，不花錢；用來在生成精緻圖之前，先確認每一格大概的畫面走向。

export type SketchScene = 'facade' | 'gate' | 'hall' | 'courtyard' | 'roof' | 'generic';
export type SketchFigureSize = 'small' | 'medium' | 'close';
export type SketchMotion = 'none' | 'in' | 'out' | 'pan';

export type SketchSpec = {
  scene: SketchScene;
  /** 場景放大倍率：遠景 1、中景 1.7、特寫 2.8 */
  zoom: number;
  /** 畫幾個人物（0–2） */
  figures: number;
  figureSize: SketchFigureSize;
  motion: SketchMotion;
};

const SCENES: Record<string, SketchScene> = {
  front_overview: 'facade',
  sanchuan_hall: 'gate',
  main_hall: 'hall',
  courtyard: 'courtyard',
  detail_roof: 'roof',
};

const ZOOMS: Record<Shot['shotSize'], number> = { 遠景: 1, 中景: 1.7, 特寫: 2.8 };
const FIGURE_SIZES: Record<Shot['shotSize'], SketchFigureSize> = { 遠景: 'small', 中景: 'medium', 特寫: 'close' };

function motionOf(cameraMove: string): SketchMotion {
  if (cameraMove.includes('推')) return 'in';
  if (cameraMove.includes('拉')) return 'out';
  if (cameraMove.includes('搖') || cameraMove.includes('移')) return 'pan';
  return 'none';
}

export function sketchSpec(shot: Pick<Shot, 'shotSize' | 'cameraMove' | 'viewKey' | 'characters'>): SketchSpec {
  return {
    scene: SCENES[shot.viewKey] ?? 'generic',
    zoom: ZOOMS[shot.shotSize],
    figures: Math.min(shot.characters.length, 2),
    figureSize: FIGURE_SIZES[shot.shotSize],
    motion: motionOf(shot.cameraMove),
  };
}

/** 手繪稿的文字說明（給輔助科技，也當圖說） */
export function sketchCaption(shot: Pick<Shot, 'shotSize' | 'cameraMove'>, viewName: string): string {
  const move = shot.cameraMove && shot.cameraMove !== '固定' ? `・${shot.cameraMove}` : '・固定';
  return `${shot.shotSize}${move}，${viewName || '還沒選視角'}`;
}
