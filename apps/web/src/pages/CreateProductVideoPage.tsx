import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  VIEW_PENDING_ITEM,
  imageModelLabel,
  planProductViews,
  type ProductVideoDetail,
  type ScenarioPackSummary,
  type Series,
} from '@templeyard/shared';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ApiRequestError,
  fetchProduct,
  fetchProductVideoDetail,
  fetchProducts,
  generateProductBoard,
  postCostEstimate,
  postProduct,
  postProductVideo,
  reuseProductBoard,
} from '../api/client';
import { BottomActionBar } from '../components/BottomActionBar';
import { Button } from '../components/Button';
import { Tag } from '../components/Tag';
import { useCostConsent } from '../features/costs/useCostConsent';
import { ProductFormFields } from '../features/products/ProductFormFields';
import { ProductPhotoSection } from '../features/products/ProductPhotoSection';
import { emptyProductForm, productFormErrors, toProductInput, type ProductForm } from '../features/products/productForm';
import { pendingMessage } from '../features/series/seriesForm';
import { ModelSection } from '../features/videos/ModelSection';
import { boardEstimateText } from '../features/videos/createVideoSteps';
import styles from './CreateVideoPage.module.css';

// 電商系列的建立影片（/series/:sid/videos/new）：選擇或新增商品 → 上傳商品照 → 建立影片 → 選模型、讓 AI 推測缺少的視角 → 產生商品定裝版
// 建立影片後，影片編號放在網址的 ?video=，重新整理後仍在。

const productsKey = (seriesId: string) => ['products', seriesId] as const;
const productKey = (productId: string) => ['product', productId] as const;
const productVideoKey = (videoId: string) => ['product-video', videoId] as const;

export function CreateProductVideoPage({ series, pack }: { series: Series; pack: ScenarioPackSummary }) {
  const noteId = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { sid = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const videoId = searchParams.get('video');
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [inferred, setInferred] = useState<ReadonlySet<string>>(new Set());
  const labels = pack.labels;

  const videoQuery = useQuery({
    queryKey: productVideoKey(videoId ?? ''),
    queryFn: () => fetchProductVideoDetail(videoId ?? ''),
    enabled: Boolean(videoId),
  });
  const detail = videoQuery.data ?? null;
  const productId = detail?.product.productId ?? chosenId;

  const productQuery = useQuery({
    queryKey: productKey(productId ?? ''),
    queryFn: () => fetchProduct(productId ?? ''),
    enabled: Boolean(productId),
  });
  const photos = productQuery.data?.photos ?? [];
  const productName = detail?.product.name ?? productQuery.data?.product.name ?? '';
  const hasBoard = detail?.video.productBoardVersionId != null;

  const planned = planProductViews(photos, [...inferred], pack.viewKeys);
  const pending: string[] = [];
  if (!productId) pending.push('選擇商品');
  else if (photos.length === 0) pending.push('上傳至少 1 張商品照');
  else if (detail && planned.length === 0) pending.push(VIEW_PENDING_ITEM);
  const ready = pending.length === 0;

  const imageModel = detail?.video.imageModel ?? series.defaultImageModel;
  const items = [{ model: imageModel, units: planned.length }];
  const estimate = useQuery({
    queryKey: ['product-board-estimate', videoId, imageModel, planned.length],
    queryFn: () => postCostEstimate(videoId ?? '', items),
    enabled: Boolean(videoId) && ready && !hasBoard,
  });
  const estimateText = boardEstimateText(planned.length, imageModelLabel(imageModel), estimate.data?.estimate ?? null);
  const consent = useCostConsent(videoId ?? '');

  const createVideo = useMutation({
    mutationFn: () => postProductVideo({ seriesId: sid, productId: productId ?? '' }),
    onSuccess: (video) => setSearchParams({ video: video.id }, { replace: true }),
  });

  function toggleInferred(key: string) {
    setInferred((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function generate() {
    if (!videoId) return;
    void consent.ask({
      items,
      confirmLabel: '同意並產生',
      run: async (consentToken) => {
        await generateProductBoard(videoId, { inferredViewKeys: [...inferred], ...(consentToken ? { consentToken } : {}) });
        navigate(`/videos/${videoId}/product-board`);
      },
    });
  }

  const refreshProduct = () => {
    if (productId) void queryClient.invalidateQueries({ queryKey: productKey(productId) });
    void queryClient.invalidateQueries({ queryKey: productsKey(sid) });
  };

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
              <Link to="/">{series.name}</Link>
            </li>
            <li aria-current="page">建立影片</li>
          </ol>
        </nav>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>建立影片</h1>
        <p className={styles.intro}>選好{labels.subject}、上傳{labels.subjectPhotos}後建立影片，再產生{labels.board}。定裝版確認後就能開始創作。</p>

        {videoQuery.isError && (
          <p className={styles.error} role="alert">
            讀不到這支影片：{videoQuery.error.message}
          </p>
        )}

        {!videoId && (
          <ProductPicker
            seriesId={sid}
            categories={pack.categories}
            chosenId={chosenId}
            onChoose={setChosenId}
          />
        )}
        {videoId && detail && (
          <section className={styles.notice} aria-label="選擇商品">
            <p>已選用商品：{productName}</p>
            <Link to={`/series/${sid}/products/${detail.product.productId}`}>商品資料</Link>
          </section>
        )}

        {productId && !hasBoard && (
          <ProductPhotoSection productId={productId} photos={photos} views={pack.viewKeys} onChanged={refreshProduct} />
        )}

        {detail && !hasBoard && detail.reusableBoard && <ReuseProductBoard detail={detail} />}
        {detail && (
          <ModelSection
            video={detail.video}
            series={series}
            boardLabel={labels.board}
            onUpdated={(video) => queryClient.setQueryData<ProductVideoDetail>(productVideoKey(video.id), (old) => (old ? { ...old, video: { ...old.video, ...video } } : old))}
          />
        )}
        {detail && !hasBoard && (
          <ViewCoverage views={pack.viewKeys} photos={photos} inferred={inferred} onToggle={toggleInferred} />
        )}
        {consent.error && (
          <p className={styles.error} role="alert">
            產生{labels.board}失敗：{consent.error}
          </p>
        )}
        {createVideo.isError && (
          <p className={styles.error} role="alert">
            建立影片失敗：{createVideo.error instanceof ApiRequestError ? createVideo.error.message : '請再試一次'}
          </p>
        )}
      </main>

      {hasBoard && videoId ? (
        <BottomActionBar note={`已產生${labels.board}`} noteId={noteId}>
          <Link className={styles.primaryLink} to={`/videos/${videoId}/product-board`}>
            前往{labels.board}
          </Link>
        </BottomActionBar>
      ) : videoId ? (
        <BottomActionBar note={pending.length > 0 ? pendingMessage(pending) : estimateText} noteId={noteId}>
          <Button variant="primary" disabled={!ready || consent.busy} aria-describedby={noteId} onClick={generate}>
            產生{labels.board}
          </Button>
        </BottomActionBar>
      ) : (
        <BottomActionBar note={pending.length > 0 ? pendingMessage(pending) : `建立影片後，再產生${labels.board}`} noteId={noteId}>
          <Button variant="primary" disabled={!ready || createVideo.isPending} aria-describedby={noteId} onClick={() => createVideo.mutate()}>
            建立影片
          </Button>
        </BottomActionBar>
      )}
      {consent.dialog}
    </div>
  );
}

/** 1 選擇商品：選用同系列已有的商品，或新增一件 */
function ProductPicker({
  seriesId,
  categories,
  chosenId,
  onChoose,
}: {
  seriesId: string;
  categories: readonly string[];
  chosenId: string | null;
  onChoose: (productId: string | null) => void;
}) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: productsKey(seriesId), queryFn: () => fetchProducts(seriesId) });
  const [form, setForm] = useState<ProductForm>(emptyProductForm());
  const [showErrors, setShowErrors] = useState(false);
  const errors = showErrors ? productFormErrors(form) : {};
  const create = useMutation({
    mutationFn: () => postProduct(seriesId, toProductInput(form)),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: productsKey(seriesId) });
      onChoose(product.id);
    },
  });
  const chosen = products.data?.find((product) => product.id === chosenId);

  function submit() {
    setShowErrors(true);
    if (Object.keys(productFormErrors(form)).length === 0) create.mutate();
  }

  return (
    <section className={styles.notice} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.noticeTitle}>
        選擇商品
      </h2>
      {chosenId ? (
        <>
          <p>已選用商品：{chosen?.name ?? '商品'}</p>
          <div>
            <Button onClick={() => onChoose(null)}>換一件商品</Button>
          </div>
        </>
      ) : (
        <>
          {products.data && products.data.length > 0 && (
            <ul>
              {products.data.map((product) => (
                <li key={product.id}>
                  {product.name}
                  <Tag tone={product.boardConfirmed ? 'success' : 'info'}>{product.boardConfirmed ? '已有商品定裝版' : `${product.photoCount} 張商品照`}</Tag>
                  <Button aria-label={`使用這件商品：${product.name}`} onClick={() => onChoose(product.id)}>
                    使用這件商品
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <h3 className={styles.noticeTitle}>新增商品</h3>
          <ProductFormFields form={form} onChange={setForm} errors={errors} categories={categories} />
          <div>
            <Button variant="primary" disabled={create.isPending} onClick={submit}>
              新增商品
            </Button>
          </div>
          {create.isError && (
            <p className={styles.error} role="alert">
              新增商品失敗：{create.error instanceof ApiRequestError ? create.error.message : '請再試一次'}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** 視角對照：有照片的視角依照片，缺少的可以讓 AI 推測 */
function ViewCoverage({
  views,
  photos,
  inferred,
  onToggle,
}: {
  views: readonly { key: string; name: string }[];
  photos: readonly { viewKey: string | null }[];
  inferred: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const titleId = useId();
  return (
    <section className={styles.notice} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.noticeTitle}>
        視角對照
      </h2>
      <p className={styles.muted}>在每張商品照指定拍到的視角；缺少照片的視角可以讓 AI 推測（推測的視角之後要確認）。</p>
      <ul>
        {views.map((view) => {
          const hasPhoto = photos.some((photo) => photo.viewKey === view.key);
          const isInferred = !hasPhoto && inferred.has(view.key);
          return (
            <li key={view.key}>
              {view.name}
              {hasPhoto && <Tag tone="success">已有照片</Tag>}
              {!hasPhoto && (isInferred ? <Tag tone="info">AI 推測</Tag> : <Tag tone="warning">缺少照片</Tag>)}
              {!hasPhoto && (
                <Button aria-label={isInferred ? `取消 AI 推測：${view.name}` : `讓 AI 推測：${view.name}`} onClick={() => onToggle(view.key)}>
                  {isInferred ? '取消 AI 推測' : '讓 AI 推測'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 同系列同一件商品已有確認過的商品定裝版：直接沿用 */
function ReuseProductBoard({ detail }: { detail: ProductVideoDetail }) {
  const titleId = useId();
  const navigate = useNavigate();
  const reusable = detail.reusableBoard;
  const reuse = useMutation({
    mutationFn: () => reuseProductBoard(detail.video.id),
    onSuccess: () => navigate(`/videos/${detail.video.id}/product-board`),
  });
  if (!reusable) return null;
  return (
    <section className={styles.notice} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.noticeTitle}>
        沿用商品定裝版
      </h2>
      <p>這件商品在這個系列已有確認過的商品定裝版（第 {reusable.version} 版，{imageModelLabel(reusable.imageModel)}），可以直接沿用</p>
      <Button variant="primary" disabled={reuse.isPending} onClick={() => reuse.mutate()}>
        沿用商品定裝版
      </Button>
      {reuse.isError && (
        <p className={styles.error} role="alert">
          沿用失敗：{reuse.error instanceof ApiRequestError ? reuse.error.message : '請再試一次'}
        </p>
      )}
    </section>
  );
}
