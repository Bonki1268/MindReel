import { describe, expect, it } from 'vitest';
import { sketchCaption, sketchSpec } from './sketchSpec';

const base = { shotSize: '中景', cameraMove: '固定', viewKey: 'main_hall', characters: [] as string[] } as const;

describe('手繪稿的構圖規則', () => {
  it('景別越近，場景放得越大、人物畫得越大', () => {
    const far = sketchSpec({ ...base, shotSize: '遠景' });
    const mid = sketchSpec({ ...base, shotSize: '中景' });
    const close = sketchSpec({ ...base, shotSize: '特寫' });
    expect([far.zoom, mid.zoom, close.zoom]).toEqual([1, 1.7, 2.8]);
    expect([far.figureSize, mid.figureSize, close.figureSize]).toEqual(['small', 'medium', 'close']);
  });

  it('運鏡的推、拉、搖各畫出對應的箭頭，其他都不畫', () => {
    expect(sketchSpec({ ...base, cameraMove: '推' }).motion).toBe('in');
    expect(sketchSpec({ ...base, cameraMove: '緩推' }).motion).toBe('in');
    expect(sketchSpec({ ...base, cameraMove: '拉' }).motion).toBe('out');
    expect(sketchSpec({ ...base, cameraMove: '搖' }).motion).toBe('pan');
    expect(sketchSpec({ ...base, cameraMove: '固定' }).motion).toBe('none');
  });

  it('場景依視角決定；補充視角與沒選視角都畫成通用的框', () => {
    expect(sketchSpec({ ...base, viewKey: 'front_overview' }).scene).toBe('facade');
    expect(sketchSpec({ ...base, viewKey: 'sanchuan_hall' }).scene).toBe('gate');
    expect(sketchSpec({ ...base, viewKey: 'detail_roof' }).scene).toBe('roof');
    expect(sketchSpec({ ...base, viewKey: 'custom:海邊' }).scene).toBe('generic');
    expect(sketchSpec({ ...base, viewKey: '' }).scene).toBe('generic');
  });

  it('人物最多畫兩個；沒有角色就不畫人物', () => {
    expect(sketchSpec({ ...base, characters: [] }).figures).toBe(0);
    expect(sketchSpec({ ...base, characters: ['導覽員阿嬤'] }).figures).toBe(1);
    expect(sketchSpec({ ...base, characters: ['阿嬤', '孫子', '路人'] }).figures).toBe(2);
  });

  it('圖說列出景別、運鏡與視角', () => {
    expect(sketchCaption({ shotSize: '遠景', cameraMove: '推' }, '廟前全景')).toBe('遠景・推，廟前全景');
    expect(sketchCaption({ shotSize: '特寫', cameraMove: '固定' }, '')).toBe('特寫・固定，還沒選視角');
  });
});
