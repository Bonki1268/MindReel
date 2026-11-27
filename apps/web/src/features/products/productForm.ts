import {
  MAX_SELLING_POINTS,
  PRICE_INVALID_MESSAGE,
  PRODUCT_CATEGORY_REQUIRED_MESSAGE,
  PRODUCT_NAME_REQUIRED_MESSAGE,
  SELLING_POINT_REQUIRED_MESSAGE,
  type CreateProductInput,
  type Product,
} from '@templeyard/shared';

// 商品表單（新增商品、商品資料頁共用）的純函式：驗證說明與後端一致

export type ProductForm = {
  name: string;
  brand: string;
  category: string;
  /** 每條賣點一個輸入框；送出時去掉空白的 */
  sellingPoints: string[];
  /** 價格以文字輸入，留白表示不填 */
  price: string;
  priceNote: string;
  specs: string;
  notes: string;
};

export type ProductFormErrors = Partial<Record<'name' | 'category' | 'sellingPoints' | 'price', string>>;

export function emptyProductForm(): ProductForm {
  return { name: '', brand: '', category: '', sellingPoints: [''], price: '', priceNote: '', specs: '', notes: '' };
}

/** 送出前的檢查：品名、類別、至少 1 條賣點必填，價格要是 0 以上的整數 */
export function productFormErrors(form: ProductForm): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (form.name.trim() === '') errors.name = PRODUCT_NAME_REQUIRED_MESSAGE;
  if (form.category.trim() === '') errors.category = PRODUCT_CATEGORY_REQUIRED_MESSAGE;
  if (form.sellingPoints.every((point) => point.trim() === '')) errors.sellingPoints = SELLING_POINT_REQUIRED_MESSAGE;
  if (form.price.trim() !== '' && !/^\d+$/.test(form.price.trim())) errors.price = PRICE_INVALID_MESSAGE;
  return errors;
}

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** 表單轉成送出的資料：去掉前後空白與空白賣點，價格轉成數字，沒填的欄位是 null */
export function toProductInput(form: ProductForm): CreateProductInput {
  return {
    name: form.name.trim(),
    brand: orNull(form.brand),
    category: form.category.trim(),
    sellingPoints: form.sellingPoints.map((point) => point.trim()).filter(Boolean),
    price: form.price.trim() === '' ? null : Number(form.price.trim()),
    priceNote: orNull(form.priceNote),
    specs: orNull(form.specs),
    notes: orNull(form.notes),
  };
}

export function productToForm(product: Product): ProductForm {
  return {
    name: product.name,
    brand: product.brand ?? '',
    category: product.category,
    sellingPoints: product.sellingPoints.length > 0 ? [...product.sellingPoints] : [''],
    price: product.price === null ? '' : String(product.price),
    priceNote: product.priceNote ?? '',
    specs: product.specs ?? '',
    notes: product.notes ?? '',
  };
}

/** 新增一條賣點；已經 5 條就不再增加 */
export function addSellingPoint(form: ProductForm): ProductForm {
  return form.sellingPoints.length >= MAX_SELLING_POINTS ? form : { ...form, sellingPoints: [...form.sellingPoints, ''] };
}

/** 刪除一條賣點；至少留一個輸入框 */
export function removeSellingPoint(form: ProductForm, index: number): ProductForm {
  const next = form.sellingPoints.filter((_, i) => i !== index);
  return { ...form, sellingPoints: next.length > 0 ? next : [''] };
}
