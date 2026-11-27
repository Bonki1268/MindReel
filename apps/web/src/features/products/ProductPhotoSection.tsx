import { useMutation } from '@tanstack/react-query';
import { MAX_PRODUCT_PHOTOS, type ProductPhoto } from '@templeyard/shared';
import { Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ApiRequestError, assetUrl, patchProductPhoto } from '../../api/client';
import { Tag } from '../../components/Tag';
import { activeBoxes } from '../deid/boxes';
import { PhotoProcessError } from '../photos/processPhoto';
import styles from '../photos/PhotoSection.module.css';
import { processAndUploadProductPhoto } from './processProductPhoto';

const ACCEPT = 'image/jpeg,image/png,image/webp';

export type ProductPhotoSectionProps = {
  productId: string;
  photos: readonly ProductPhoto[];
  /** 情境包的視角清單：每張照片可以指定拍到的視角 */
  views: readonly { key: string; name: string }[];
  /** 上傳或改視角後，請上層重新讀取商品照 */
  onChanged: () => void;
  /** 不能再增減照片（例如影片已產生商品定裝版）仍可看，不顯示上傳 */
  readOnly?: boolean;
};

/** 商品照：在瀏覽器去識別後才上傳（臉孔自動遮蔽，原圖只存這台電腦）；可指定拍到的視角 */
export function ProductPhotoSection({ productId, photos, views, onChanged, readOnly = false }: ProductPhotoSectionProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = photos.length >= MAX_PRODUCT_PHOTOS;

  async function upload(files: File[]) {
    setError(null);
    const accepted = files.slice(0, Math.max(0, MAX_PRODUCT_PHOTOS - photos.length));
    if (accepted.length === 0) return;
    setBusy(true);
    try {
      for (const file of accepted) await processAndUploadProductPhoto(productId, file, null);
      onChanged();
    } catch (cause: unknown) {
      setError(cause instanceof PhotoProcessError || cause instanceof ApiRequestError ? cause.message : '照片上傳失敗，請再試一次。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          商品照
        </h2>
        <p className={styles.count}>
          {photos.length} / {MAX_PRODUCT_PHOTOS} 張
        </p>
      </div>
      <p className={styles.intro}>
        上傳 1～{MAX_PRODUCT_PHOTOS} 張這件商品的照片，盡量涵蓋不同角度。照片裡的臉孔會在你的電腦上自動遮蔽，原圖只存在這台電腦。
      </p>

      {photos.length > 0 && (
        <ul className={styles.grid}>
          {photos.map((photo, index) => (
            <li key={photo.id}>
              <ProductPhotoCard productId={productId} photo={photo} name={`商品照 ${index + 1}`} views={views} readOnly={readOnly} onChanged={onChanged} />
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className={styles.uploadRow}>
          <label className={styles.upload} data-disabled={busy || full ? 'true' : undefined}>
            <input
              ref={inputRef}
              className={styles.visuallyHidden}
              type="file"
              accept={ACCEPT}
              multiple
              disabled={busy || full}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length > 0) void upload(files);
              }}
            />
            <Upload size={18} strokeWidth={1.8} aria-hidden="true" />
            上傳商品照
          </label>
          {full && <p className={styles.muted}>已達 {MAX_PRODUCT_PHOTOS} 張上限</p>}
        </div>
      )}
      <p className={styles.muted} role="status">
        {busy ? '正在去識別照片…' : ''}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ProductPhotoCard({
  productId,
  photo,
  name,
  views,
  readOnly,
  onChanged,
}: {
  productId: string;
  photo: ProductPhoto;
  name: string;
  views: readonly { key: string; name: string }[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const selectId = useId();
  const setView = useMutation({
    mutationFn: (viewKey: string | null) => patchProductPhoto(productId, photo.id, { viewKey }),
    onSuccess: onChanged,
  });
  const masked = activeBoxes(photo.deidBoxes).length;
  return (
    <article className={styles.card} aria-label={name}>
      <img className={styles.thumb} src={assetUrl(photo.deidentifiedAssetId)} alt={`${name}（已去識別）`} />
      <div className={styles.cardBody}>
        <div className={styles.cardTags}>
          <Tag tone="success">已去識別</Tag>
          <span className={styles.muted}>遮蔽 {masked} 處</span>
        </div>
        <label className={styles.viewLabel} htmlFor={selectId}>
          {name}拍到的視角
        </label>
        <select
          id={selectId}
          className={styles.select}
          value={photo.viewKey ?? ''}
          disabled={readOnly || setView.isPending}
          onChange={(event) => setView.mutate(event.target.value === '' ? null : event.target.value)}
        >
          <option value="">未指定</option>
          {views.map((view) => (
            <option key={view.key} value={view.key}>
              {view.name}
            </option>
          ))}
        </select>
        {setView.isError && (
          <p className={styles.error} role="alert">
            指定視角失敗：{setView.error.message}
          </p>
        )}
      </div>
    </article>
  );
}
