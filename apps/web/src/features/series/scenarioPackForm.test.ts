import { SERIES_DIRECTIONS } from '@templeyard/shared';
import { describe, expect, it } from 'vitest';
import { directionsFor, reconcileDirection } from './scenarioPackForm';
import { initialSeriesForm } from './seriesForm';

describe('建立系列表單的情境包', () => {
  it('影片方向的選項依情境包', () => {
    expect(directionsFor({ directions: ['新品上市', '促銷活動'] })).toEqual(['新品上市', '促銷活動']);
  });

  it('還沒讀到情境包清單時，用廟埕包的選項', () => {
    expect(directionsFor(undefined)).toEqual([...SERIES_DIRECTIONS]);
  });

  it('換情境包後，原本選的方向不在新選項裡就清掉', () => {
    const form = { ...initialSeriesForm(), directionOption: '歷史故事' };
    expect(reconcileDirection(form, ['新品上市', '促銷活動']).directionOption).toBeNull();
  });

  it('原本選的方向在新選項裡就保留', () => {
    const form = { ...initialSeriesForm(), directionOption: '促銷活動' };
    expect(reconcileDirection(form, ['新品上市', '促銷活動']).directionOption).toBe('促銷活動');
  });

  it('自己寫的方向不受影響', () => {
    const form = { ...initialSeriesForm(), directionOther: '廟口美食' };
    expect(reconcileDirection(form, ['新品上市']).directionOther).toBe('廟口美食');
  });
});
