import { MAX_SELLING_POINTS } from '@templeyard/shared';
import { Button } from '../../components/Button';
import { OptionGroup } from '../../components/OptionGroup';
import { TextField } from '../../components/TextField';
import { addSellingPoint, removeSellingPoint, type ProductForm, type ProductFormErrors } from './productForm';

export type ProductFormFieldsProps = {
  form: ProductForm;
  onChange: (form: ProductForm) => void;
  errors: ProductFormErrors;
  /** 情境包的商品類別清單 */
  categories: readonly string[];
};

/** 商品欄位：品名、品牌、類別、賣點 1～5 條、價格與價格說明、規格、注意事項（新增商品與商品資料頁共用） */
export function ProductFormFields({ form, onChange, errors, categories }: ProductFormFieldsProps) {
  const set = (patch: Partial<ProductForm>) => onChange({ ...form, ...patch });
  return (
    <>
      <TextField label="品名" value={form.name} onChange={(name) => set({ name })} error={errors.name} maxLength={80} />
      <TextField label="品牌" value={form.brand} onChange={(brand) => set({ brand })} maxLength={60} />
      <OptionGroup
        legend="商品類別"
        options={categories.map((category) => ({ value: category, label: category }))}
        value={form.category || null}
        onChange={(category) => set({ category })}
      />
      {errors.category && <TextFieldError message={errors.category} />}

      {form.sellingPoints.map((point, index) => (
        <div key={index}>
          <TextField
            label={`賣點 ${index + 1}`}
            value={point}
            maxLength={100}
            error={index === 0 ? errors.sellingPoints : undefined}
            onChange={(value) => set({ sellingPoints: form.sellingPoints.map((item, i) => (i === index ? value : item)) })}
          />
          {form.sellingPoints.length > 1 && (
            <Button aria-label={`刪除賣點 ${index + 1}`} onClick={() => onChange(removeSellingPoint(form, index))}>
              刪除
            </Button>
          )}
        </div>
      ))}
      <div>
        <Button disabled={form.sellingPoints.length >= MAX_SELLING_POINTS} onClick={() => onChange(addSellingPoint(form))}>
          新增賣點
        </Button>
      </div>

      <TextField label="價格" value={form.price} onChange={(price) => set({ price })} error={errors.price} placeholder="新台幣元，只填數字" />
      <TextField label="價格說明" value={form.priceNote} onChange={(priceNote) => set({ priceNote })} maxLength={100} placeholder="例如：原價 1,280，限時 990（影片中逐字使用）" />
      <TextField label="規格" value={form.specs} onChange={(specs) => set({ specs })} multiline maxLength={1000} />
      <TextField label="注意事項" value={form.notes} onChange={(notes) => set({ notes })} multiline maxLength={1000} />
    </>
  );
}

/** 選項群組下方的錯誤說明（OptionGroup 本身沒有錯誤欄位） */
function TextFieldError({ message }: { message: string }) {
  return (
    <p role="alert" style={{ margin: 0, color: 'var(--color-error)' }}>
      {message}
    </p>
  );
}
