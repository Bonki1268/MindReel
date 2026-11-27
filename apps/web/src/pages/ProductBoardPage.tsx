import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PRODUCT_LIGHTING_OPTIONS,
  creditsText,
  imageModelLabel,
  viewTags,
  type ProductBoard,
  type ProductLighting,
  type ProductView,
} from '@templeyard/shared';
import { useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ApiRequestError,
  assetUrl,
  confirmProductBoard,
  confirmProductView,
  fetchProductBoard,
  fetchVideoBudget,
  patchProductBoard,
  regenerateProductView,
  saveProductBoardVersion,
} from '../api/client';
import { BottomActionBar } from '../components/BottomActionBar';
import { Button } from '../components/Button';
import { OptionGroup } from '../components/OptionGroup';
import { Tag } from '../components/Tag';
import { TextField } from '../components/TextField';
import { useCostConsent } from '../features/costs/useCostConsent';
import page from './CreateVideoPage.module.css';
import styles from './TempleBoardPage.module.css';

// 商品定裝版（/videos/:vid/product-board）：檢視、單張重生與修改、確認 AI 推測、外觀規範與光線、確認定裝版（結構同寺廟定裝版）

const boardKey = (videoId: string) => ['product-board', videoId] as const;

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function ProductBoardPage() {
  const noteId = useId();
  const { vid = '' } = useParams();
  const queryClient = useQueryClient();
  const board = useQuery({
    queryKey: boardKey(vid),
    queryFn: () => fetchProductBoard(vid),
    retry: false,
    // 生成中時每秒查一次，完成後停止
    refetchInterval: (query) => (query.state.data?.views.some((view) => view.state === 'generating') ? 1000 : false),
  });
  const budget = useQuery({ queryKey: ['budget', vid], queryFn: () => fetchVideoBudget(vid) });
  const setBoard = (next: ProductBoard) => queryClient.setQueryData(boardKey(vid), next);
  const confirm = useMutation({ mutationFn: () => confirmProductBoard(vid), onSuccess: setBoard });
  const saveVersion = useMutation({ mutationFn: () => saveProductBoardVersion(vid), onSuccess: setBoard });

  const notFound = board.isError && board.error instanceof ApiRequestError && board.error.status === 404;
  const data = board.data;
  const confirmed = data?.version.confirmedAt != null;
  const generatingCount = data?.views.filter((view) => view.state === 'generating').length ?? 0;
  const pending = data?.pending ?? [];
  const note = confirmed ? '商品定裝版已確認' : pending.length > 0 ? pending.join('；') : '確認後，之後每一格的商品外觀都以這份定裝版為準';

  return (
    <div className={page.page}>
      <header className={page.header}>
        <Link to="/" className={page.brand}>
          <span className={page.mark} aria-hidden="true">
            廟
          </span>
          廟埕影室
        </Link>
        <nav aria-label="目前位置">
          <ol className={page.breadcrumb}>
            <li>
              <Link to="/">系列</Link>
            </li>
            <li aria-current="page">{data?.productName ?? '商品定裝版'}</li>
          </ol>
        </nav>
        {budget.data && (
          <p className={styles.cost}>
            費用 {creditsText(budget.data.spent + budget.data.reserved)} / 上限 {budget.data.limit === null ? '[未設定]' : creditsText(budget.data.limit)}
          </p>
        )}
      </header>

      <main className={page.main}>
        {notFound && <p className={page.error} role="alert">這支影片還沒產生商品定裝版。</p>}
        {board.isError && !notFound && (
          <p className={page.error} role="alert">
            讀不到商品定裝版：{errorText(board.error, '請重新整理頁面')}
          </p>
        )}

        {data && (
          <>
            <h1 className={page.title}>{data.productName}・商品定裝版</h1>
            <p className={page.intro}>這是這件商品的外觀規範。之後每一格出現的商品外觀、包裝與光線，都會以這裡為準。</p>

            <div className={styles.versionRow}>
              {confirmed ? (
                <>
                  <p>第 {data.version.version} 版已確認；要修改請先另存新版本</p>
                  <Button disabled={saveVersion.isPending} onClick={() => saveVersion.mutate()}>
                    另存新版本
                  </Button>
                </>
              ) : (
                <p>第 {data.version.version} 版，尚未確認</p>
              )}
              {data.otherImageModel && <Tag tone="warning">由其他圖片模型產生：{imageModelLabel(data.version.imageModel)}</Tag>}
            </div>
            {saveVersion.isError && (
              <p className={page.error} role="alert">
                另存新版本失敗：{errorText(saveVersion.error, '請再試一次')}
              </p>
            )}

            <p className={styles.status} role="status" aria-live="polite">
              {generatingCount > 0 ? `生成中・商品定裝版 ${generatingCount} 張；可以先離開這一頁，完成後回來查看` : ''}
            </p>

            <section aria-labelledby={`${noteId}-views`}>
              <h2 id={`${noteId}-views`} className={styles.sectionTitle}>
                視角圖
              </h2>
              <ul className={styles.grid}>
                {data.views.map((view) => (
                  <li key={view.id}>
                    <ViewCard videoId={vid} view={view} locked={confirmed} imageModel={data.version.imageModel} onBoard={setBoard} />
                  </li>
                ))}
              </ul>
            </section>

            <AppearanceSection key={data.version.id} board={data} locked={confirmed} onBoard={setBoard} />
          </>
        )}
      </main>

      {data && (
        <BottomActionBar note={note} noteId={noteId}>
          <Button variant="primary" disabled={confirmed || pending.length > 0 || confirm.isPending} aria-describedby={noteId} onClick={() => confirm.mutate()}>
            確認商品定裝版
          </Button>
        </BottomActionBar>
      )}
      {confirm.isError && (
        <p className={page.error} role="alert">
          確認失敗：{errorText(confirm.error, '請再試一次')}
        </p>
      )}
    </div>
  );
}

type ViewCardProps = {
  videoId: string;
  view: ProductView;
  /** 版本已確認：不能重生或修改 */
  locked: boolean;
  imageModel: string;
  onBoard: (board: ProductBoard) => void;
};

/** 視角圖卡：預覽、名稱、來源標籤、重生與修改 */
function ViewCard({ videoId, view, locked, imageModel, onBoard }: ViewCardProps) {
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const consent = useCostConsent(videoId);
  const confirmView = useMutation({ mutationFn: () => confirmProductView(videoId, view.viewKey), onSuccess: onBoard });
  const generating = view.state === 'generating';
  const busy = generating || consent.busy || locked;

  function regenerate(withInstruction: string | null) {
    void consent.ask({
      items: [{ model: imageModel, units: 1 }],
      confirmLabel: '同意並重生',
      run: async (consentToken) => {
        const next = await regenerateProductView(videoId, view.viewKey, {
          ...(withInstruction ? { instruction: withInstruction } : {}),
          ...(consentToken ? { consentToken } : {}),
        });
        onBoard(next);
        setEditing(false);
      },
    });
  }

  return (
    <article className={styles.card} aria-label={`視角圖：${view.viewName}`}>
      <div className={styles.preview}>
        {view.assetId && !generating ? (
          <img className={styles.image} src={assetUrl(view.assetId)} alt={`${view.viewName}視角圖`} />
        ) : (
          <span className={styles.placeholder}>{generating ? '生成中' : '還沒有視角圖'}</span>
        )}
      </div>
      <div className={styles.cardBody}>
        <h3 className={styles.cardTitle}>{view.viewName}</h3>
        <div className={styles.tags}>
          {viewTags(view).map((tag) => (
            <Tag key={tag} tone={tag === '依照片' || tag === 'AI 推測・已確認' ? 'success' : 'warning'}>
              {tag}
            </Tag>
          ))}
        </div>
        {view.state === 'failed' && <p className={styles.failure}>生成失敗：{view.error ?? '雲端沒有說明原因'}</p>}

        <div className={styles.actions}>
          <Button aria-label={`重生：${view.viewName}`} disabled={busy} onClick={() => regenerate(null)}>
            重生
          </Button>
          <Button aria-label={`修改：${view.viewName}`} aria-expanded={editing} disabled={busy} onClick={() => setEditing((on) => !on)}>
            修改
          </Button>
          {!view.confirmed && view.state === 'ready' && !locked && (
            <Button aria-label={`確認這張：${view.viewName}`} disabled={confirmView.isPending} onClick={() => confirmView.mutate()}>
              確認這張
            </Button>
          )}
        </div>

        {editing && (
          <div className={styles.edit}>
            <TextField
              label={`修改這張：${view.viewName}`}
              value={instruction}
              onChange={setInstruction}
              multiline
              maxLength={500}
              placeholder="例如：背景再乾淨一點，保留杯身的反光"
            />
            <Button
              variant="primary"
              aria-label={`依指令重生：${view.viewName}`}
              disabled={busy || instruction.trim() === ''}
              onClick={() => regenerate(instruction.trim())}
            >
              依指令重生
            </Button>
          </div>
        )}
        {(consent.error ?? confirmView.error) && (
          <p className={styles.failure} role="alert">
            {consent.error ?? errorText(confirmView.error, '請再試一次')}
          </p>
        )}
      </div>
      {consent.dialog}
    </article>
  );
}

/** 外觀規範（連續性鎖）與光線：逐字帶進之後每一格的生成指令 */
function AppearanceSection({ board, locked, onBoard }: { board: ProductBoard; locked: boolean; onBoard: (board: ProductBoard) => void }) {
  const titleId = useId();
  const [locks, setLocks] = useState<string[]>(board.version.appearanceLocks.length > 0 ? board.version.appearanceLocks : ['']);
  const [lighting, setLighting] = useState<ProductLighting | null>(
    (PRODUCT_LIGHTING_OPTIONS as readonly string[]).includes(board.version.defaultLighting) ? (board.version.defaultLighting as ProductLighting) : null,
  );
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      patchProductBoard(board.videoId, {
        appearanceLocks: locks.map((lock) => lock.trim()).filter(Boolean),
        ...(lighting ? { defaultLighting: lighting } : {}),
      }),
    onSuccess: (next) => {
      onBoard(next);
      setSaved(true);
    },
  });

  return (
    <section className={styles.appearance} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.sectionTitle}>
        外觀規範（連續性鎖）
      </h2>
      <p className={styles.hint}>這些固定短語會逐字帶進每一格的生成指令，讓商品的樣子不會跑掉。建議用英文寫，例如「matte white ceramic body with a brushed steel lid」。</p>
      {locks.map((lock, index) => (
        <TextField
          key={index}
          label={`外觀規範第 ${index + 1} 條`}
          value={lock}
          disabled={locked}
          maxLength={200}
          onChange={(value) => {
            setSaved(false);
            setLocks((old) => old.map((item, i) => (i === index ? value : item)));
          }}
        />
      ))}
      <Button disabled={locked || locks.length >= 10} onClick={() => setLocks((old) => [...old, ''])}>
        新增一條
      </Button>

      <OptionGroup
        legend="光線與時段"
        options={PRODUCT_LIGHTING_OPTIONS.map((option) => ({ value: option, label: option }))}
        value={lighting}
        onChange={(value) => {
          setSaved(false);
          setLighting(value);
        }}
        disabled={locked}
      />
      <p className={styles.hint}>這件商品的預設，可在分鏡細修中單格調整。</p>

      <Button disabled={locked || save.isPending} onClick={() => save.mutate()}>
        儲存外觀規範與光線
      </Button>
      <p className={styles.status} role="status">
        {saved ? '已儲存，之後重生的視角圖會使用新的外觀規範與光線' : ''}
      </p>
      {save.isError && (
        <p className={styles.failure} role="alert">
          儲存失敗：{errorText(save.error, '請再試一次')}
        </p>
      )}
    </section>
  );
}
