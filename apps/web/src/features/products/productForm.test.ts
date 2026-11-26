import { describe, expect, it } from 'vitest';
import type { Product } from '@templeyard/shared';
import { addSellingPoint, emptyProductForm, productFormErrors, productToForm, removeSellingPoint, toProductInput } from './productForm';

const filled = { ...emptyProductForm(), name: '玻璃保溫杯', category: '居家生活', sellingPoints: ['保溫 12 小時'] };

describe('商品表單（F25）', () => {
  it('空白表單：品名、類別、賣點都要填，說明和後端一致', () => {
    expect(productFormErrors(emptyProductForm())).toEqual({
      name: '請填寫品名',
      category: '請選擇商品類別',
      sellingPoints: '至少填寫 1 條賣點',
    });
  });

  it('品名、類別、至少一條賣點填好就沒有錯誤', () => {
    expect(productFormErrors(filled)).toEqual({});
  });

  it('賣點只有空白不算填了', () => {
    expect(productFormErrors({ ...filled, sellingPoints: ['  ', ''] }).sellingPoints).toBe('至少填寫 1 條賣點');
  });

  it('價格要是 0 以上的整數；留白表示不填', () => {
    expect(productFormErrors({ ...filled, price: '990' })).toEqual({});
    expect(productFormErrors({ ...filled, price: '' })).toEqual({});
    expect(productFormErrors({ ...filled, price: '-5' }).price).toBe('價格要是 0 以上的整數');
    expect(productFormErrors({ ...filled, price: '12.5' }).price).toBe('價格要是 0 以上的整數');
    expect(productFormErrors({ ...filled, price: 'abc' }).price).toBe('價格要是 0 以上的整數');
  });

  it('送出的資料：去掉前後空白與空白賣點，價格轉成數字，沒填的欄位是 null', () => {
    expect(
      toProductInput({ ...filled, name: ' 玻璃保溫杯 ', brand: ' 山嵐 ', sellingPoints: [' 保溫 12 小時 ', '', '食品級'], price: '990', priceNote: '', specs: '容量 500ml', notes: '' }),
    ).toEqual({
      name: '玻璃保溫杯',
      brand: '山嵐',
      category: '居家生活',
      sellingPoints: ['保溫 12 小時', '食品級'],
      price: 990,
      priceNote: null,
      specs: '容量 500ml',
      notes: null,
    });
  });

  it('賣點最多 5 條：新增到 5 條就不再增加；刪除時至少留一欄', () => {
    let form = emptyProductForm();
    for (let i = 0; i < 8; i += 1) form = addSellingPoint(form);
    expect(form.sellingPoints).toHaveLength(5);
    for (let i = 0; i < 8; i += 1) form = removeSellingPoint(form, 0);
    expect(form.sellingPoints).toHaveLength(1);
  });

  it('從商品帶回表單：價格是文字、沒有的欄位是空字串', () => {
    const product: Product = {
      id: 'p1',
      seriesId: 's1',
      name: '玻璃保溫杯',
      brand: null,
      category: '居家生活',
      sellingPoints: ['保溫 12 小時'],
      price: 990,
      priceNote: null,
      specs: null,
      notes: null,
      createdAt: 'x',
      updatedAt: 'x',
    };
    expect(productToForm(product)).toEqual({
      name: '玻璃保溫杯',
      brand: '',
      category: '居家生活',
      sellingPoints: ['保溫 12 小時'],
      price: '990',
      priceNote: '',
      specs: '',
      notes: '',
    });
  });
});
