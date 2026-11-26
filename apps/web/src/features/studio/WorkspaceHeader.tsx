import { useQuery } from '@tanstack/react-query';
import { imageModelLabel, videoModelLabel } from '@templeyard/shared';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { fetchVideoBudget } from '../../api/client';
import page from '../../pages/CreateVideoPage.module.css';
import styles from './WorkspaceHeader.module.css';

type WorkspaceHeaderProps = {
  videoId: string;
  /** 給輔助科技的頁面標題（畫面上不顯示） */
  title: string;
  /** 目前位置：最後一項是目前這一頁，沒有連結 */
  crumbs: { label: string; to?: string }[];
  imageModel: string;
  videoModel: string;
  /** 麵包屑右邊的額外控制項（例如面板選單） */
  children?: ReactNode;
};

/** 創作工作區與分鏡細修共用的頂端列：品牌、目前位置、鎖定的模型、費用 */
export function WorkspaceHeader({ videoId, title, crumbs, imageModel, videoModel, children }: WorkspaceHeaderProps) {
  const budget = useQuery({ queryKey: ['budget', videoId], queryFn: () => fetchVideoBudget(videoId) });
  return (
    <header className={styles.header}>
      <Link to="/" className={page.brand}>
        <span className={page.mark} aria-hidden="true">
          廟
        </span>
        廟埕影室
      </Link>
      <h1 className={styles.visuallyHidden}>{title}</h1>
      <nav aria-label="目前位置" className={styles.crumbs}>
        {crumbs.map((crumb, index) => (
          <span key={`${index}-${crumb.label}`} className={styles.crumb}>
            {index > 0 && <span aria-hidden="true">›</span>}
            {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span className={styles.crumbCurrent}>{crumb.label}</span>}
          </span>
        ))}
      </nav>
      {children && <div className={styles.extra}>{children}</div>}
      <div className={styles.spacer} />
      <dl className={styles.facts}>
        <div className={styles.pill}>
          <Lock size={14} strokeWidth={1.8} aria-hidden="true" />
          <dt>圖片</dt>
          <dd>{imageModelLabel(imageModel)}</dd>
        </div>
        <div className={styles.pill}>
          <Lock size={14} strokeWidth={1.8} aria-hidden="true" />
          <dt>影片</dt>
          <dd>{videoModelLabel(videoModel)}</dd>
        </div>
        <div className={styles.cost}>
          <dt>費用</dt>
          <dd>
            {budget.data ? (
              <>
                <span>已用 {budget.data.spent} 點</span>
                <span aria-hidden="true">/</span>
                <span>{budget.data.limit === null ? '上限未設定' : `上限 ${budget.data.limit} 點`}</span>
              </>
            ) : (
              '讀取中'
            )}
          </dd>
        </div>
      </dl>
    </header>
  );
}
