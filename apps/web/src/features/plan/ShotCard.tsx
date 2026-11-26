import { SHOT_SIZES, missingViewName, shotTitle, type Shot, type ShotCheck, type ShotInput } from '@templeyard/shared';
import { Check, Ellipsis, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { AIAssistButton } from '../../components/AIAssistButton';
import styles from './PlanPanel.module.css';
import { ShotSketch } from './ShotSketch';
import { sketchCaption, sketchSpec } from './sketchSpec';

type ShotCardProps = {
  videoId: string;
  shot: Shot;
  check: ShotCheck | undefined;
  views: readonly { viewKey: string; viewName: string }[];
  index: number;
  count: number;
  /** 檢視舊版本時不能改 */
  readOnly: boolean;
  busy: boolean;
  /** 改了這一格的欄位（文字在離開欄位時才送出） */
  onChange: (patch: Partial<ShotInput>) => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDrop: () => void;
};

type TextKey = 'description' | 'dialogue' | 'subtitle';

function isControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('textarea, input, select, button, a, label') !== null;
}

/** 分鏡卡片：左邊序號、時間與手繪稿；中間景別、視角、畫面內容、台詞、字幕；右邊細修與更多操作 */
export function ShotCard({ videoId, shot, check, views, index, count, readOnly, busy, onChange, onMove, onDuplicate, onRemove, onDragStart, onDrop }: ShotCardProps) {
  const name = `第 ${shot.seq} 格`;
  const [texts, setTexts] = useState<Record<TextKey, string>>({ description: shot.description, dialogue: shot.dialogue, subtitle: shot.subtitle });
  const missing = missingViewName(shot.viewKey);
  const disabled = readOnly || busy;
  const viewName = missing ?? views.find((view) => view.viewKey === shot.viewKey)?.viewName ?? '';

  function commit(key: TextKey) {
    if (texts[key] !== shot[key]) onChange({ [key]: texts[key] });
  }

  function field(key: TextKey, label: string, className: string | undefined, rows: number, placeholder = '') {
    return (
      <label className={styles.plainField}>
        <span className={styles.visuallyHidden}>{`${name}的${label}`}</span>
        <textarea
          aria-label={`${name}的${label}`}
          className={className}
          rows={rows}
          value={texts[key]}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => setTexts((old) => ({ ...old, [key]: event.target.value }))}
          onBlur={() => commit(key)}
        />
      </label>
    );
  }

  return (
    <article
      className={`${styles.card} ${check?.dialogueOverflow ? styles.cardError : ''}`}
      aria-label={name}
      draggable={!disabled}
      // 備援：瀏覽器沒有啟動 HTML5 拖曳時（例如按住後直接移到別的卡片放開），用滑鼠按下與放開完成排序；
      // 從輸入框、選單、按鈕開始的不算，才不會干擾選取文字
      onMouseDown={(event) => {
        if (!disabled && !isControl(event.target)) onDragStart();
      }}
      onMouseUp={() => {
        if (!disabled) onDrop();
      }}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) onDrop();
      }}
    >
      <div className={styles.cardLeft}>
        <h3 className={styles.cardTitle}>{shotTitle(shot)}</h3>
        <figure className={styles.sketchBox}>
          <ShotSketch spec={sketchSpec(shot)} label={sketchCaption(shot, viewName)} />
          <figcaption>手繪稿・依景別、運鏡與視角畫的構圖示意</figcaption>
        </figure>
      </div>

      <div className={styles.cardMid}>
        <div className={styles.chips}>
          <select
            className={styles.chipSelect}
            aria-label={`${name}的景別`}
            value={shot.shotSize}
            disabled={disabled}
            onChange={(event) => onChange({ shotSize: event.target.value as ShotInput['shotSize'] })}
          >
            {SHOT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span className={styles.chip}>運鏡：{shot.cameraMove || '固定'}</span>
          <select
            className={styles.chipSelect}
            aria-label={`${name}的場景視角`}
            value={shot.viewKey}
            disabled={disabled}
            onChange={(event) => onChange({ viewKey: event.target.value })}
          >
            {shot.viewKey === '' && <option value="">請選擇視角</option>}
            {missing && <option value={shot.viewKey}>{`${missing}（定裝版沒有）`}</option>}
            {views.map((view) => (
              <option key={view.viewKey} value={view.viewKey}>
                {view.viewName}
              </option>
            ))}
          </select>
          {missing && <span className={`${styles.chip} ${styles.chipWarning}`}>{`缺少視角：${missing}`}</span>}
          {check?.dialogueOverflow && <span className={`${styles.chip} ${styles.chipError}`}>對白放不下</span>}
        </div>

        {field('description', '畫面內容', styles.descriptionText, 2)}
        {field('dialogue', '台詞或旁白', styles.dialogueText, 1, '無台詞')}
        <div className={styles.metaRow}>
          <span className={styles.subtitleBox}>
            <span aria-hidden="true">字幕：</span>
            {field('subtitle', '字幕', styles.subtitleText, 1, '—')}
          </span>
          {check?.dialogueEstimateSec !== null && check?.dialogueEstimateSec !== undefined && (
            <span className={check.dialogueOverflow ? styles.estimateBad : styles.estimateOk}>
              {check.dialogueOverflow ? <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" /> : <Check size={14} strokeWidth={2} aria-hidden="true" />}
              {check.dialogueOverflow
                ? `對白估時 ${check.dialogueEstimateSec.toFixed(1)} 秒，這一格只有 ${shot.durationSec} 秒：請延長秒數或拆成兩格，不要加快語速`
                : `對白估時 ${check.dialogueEstimateSec.toFixed(1)} 秒（暫估）`}
            </span>
          )}
        </div>
        {check?.shortWarning && <p className={styles.warning}>{check.shortWarning}</p>}
      </div>

      {!readOnly && (
        <div className={styles.cardRight}>
          <Link className={styles.detailLink} to={`/videos/${videoId}/shots/${shot.shotKey}?from=plan`} aria-label={`細修：${name}`}>
            細修
          </Link>
          <AIAssistButton field={name} disabled title="只重寫這一格的功能還沒開放" />
          <CardMenu name={name} busy={busy} index={index} count={count} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} />
        </div>
      )}
    </article>
  );
}

type CardMenuProps = Pick<ShotCardProps, 'index' | 'count' | 'busy' | 'onMove' | 'onDuplicate' | 'onRemove'> & { name: string };

/** 「…」更多操作：上移、下移、複製、刪除；按外面或 Esc 收起 */
function CardMenu({ name, busy, index, count, onMove, onDuplicate, onRemove }: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className={styles.menuWrap} ref={wrap}>
      <button type="button" className={styles.moreButton} aria-label={`${name}的更多操作`} aria-expanded={open} aria-controls={popupId} onClick={() => setOpen((value) => !value)}>
        <Ellipsis size={18} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open && (
        <div id={popupId} className={styles.menu} role="group" aria-label={`${name}的操作`}>
          <button type="button" aria-label={`上移：${name}`} disabled={busy || index === 0} onClick={() => run(() => onMove(index - 1))}>
            上移
          </button>
          <button type="button" aria-label={`下移：${name}`} disabled={busy || index === count - 1} onClick={() => run(() => onMove(index + 1))}>
            下移
          </button>
          <button type="button" aria-label={`複製：${name}`} disabled={busy} onClick={() => run(onDuplicate)}>
            複製
          </button>
          <button type="button" aria-label={`刪除：${name}`} disabled={busy || count <= 1} onClick={() => run(onRemove)}>
            刪除
          </button>
        </div>
      )}
    </div>
  );
}
