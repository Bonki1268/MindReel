import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductDetail } from '@templeyard/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiRequestError, fetchProduct, patchProduct } from '../api/client';
import { Button } from '../components/Button';
import { ProductFormFields } from '../features/products/ProductFormFields';
import { ProductPhotoSection } from '../features/products/ProductPhotoSection';
import { productFormErrors, productToForm, toProductInput, type ProductForm } from '../features/products/productForm';
import { useScenarioPack } from '../features/series/useScenarioPacks';
import { useSeriesList } from '../features/series/useSeriesList';
import styles from './CreateVideoPage.module.css';

// 商品資料頁（/series/:sid/products/:pid）：檢視與修改商品、管理商品照；修改只影響之後新增的影片

export function ProductPage() {
  const { sid = '', pid = '' } = useParams();
  const seriesList = useSeriesList();
  const series = seriesList.data?.find((item) => item.id === sid);
  const query = useQuery({ queryKey: ['product', pid], queryFn: () => fetchProduct(pid) });
  const loaded = query.data?.product;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            廟
          </span>
          廟埕影室
        </Link>
        <nav aria-label="目前位置">
          <ol className={styles.breadcrumb}>
            <li>
              <Link to="/">{series?.name ?? '系列'}</Link>
            </li>
            <li aria-current="page">{loaded?.name ?? '商品'}</li>
          </ol>
        </nav>
      </header>

      <main className={styles.main}>
        {query.isError && (
          <p className={styles.error} role="alert">
            讀不到這件商品：{query.error instanceof ApiRequestError ? query.error.message : '請重新整理頁面'}
          </p>
        )}
        {query.data && <ProductEditor key={query.data.product.id} seriesId={sid} productId={pid} scenarioPack={series?.scenarioPack} detail={query.data} />}
        {series && (
          <p>
            <Link to={`/series/${sid}/videos/new`}>回到建立影片</Link>
          </p>
        )}
      </main>
    </div>
  );
}

function ProductEditor({ seriesId, productId, scenarioPack, detail }: { seriesId: string; productId: string; scenarioPack: string | undefined; detail: ProductDetail }) {
  const queryClient = useQueryClient();
  const pack = useScenarioPack(scenarioPack);
  const [form, setForm] = useState<ProductForm>(() => productToForm(detail.product));
  const [showErrors, setShowErrors] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (value: ProductForm) => patchProduct(productId, toProductInput(value)),
    onSuccess: (product) => {
      setSaved(true);
      setForm(productToForm(product));
      queryClient.setQueryData<ProductDetail>(['product', productId], (old) => (old ? { ...old, product } : old));
      void queryClient.invalidateQueries({ queryKey: ['products', seriesId] });
    },
  });
  const errors = showErrors ? productFormErrors(form) : {};

  function submit() {
    setShowErrors(true);
    setSaved(false);
    if (Object.keys(productFormErrors(form)).length === 0) save.mutate(form);
  }

  return (
    <>
      <h1 className={styles.title}>{detail.product.name}</h1>
      <p className={styles.intro}>修改商品只影響之後新增的影片；已建立的影片保留建立時的商品資料。</p>
      <ProductFormFields
        form={form}
        onChange={(next) => {
          setSaved(false);
          setForm(next);
        }}
        errors={errors}
        categories={pack?.categories ?? [detail.product.category]}
      />
      <div>
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          儲存商品
        </Button>
      </div>
      <p role="status">{saved ? '商品已儲存；之後新增的影片會用新的資料，已建立的影片不受影響' : ''}</p>
      {save.isError && (
        <p className={styles.error} role="alert">
          儲存失敗：{save.error instanceof ApiRequestError ? save.error.message : '請再試一次'}
        </p>
      )}
      <ProductPhotoSection
        productId={productId}
        photos={detail.photos}
        views={pack?.viewKeys ?? []}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ['product', productId] })}
      />
    </>
  );
}
