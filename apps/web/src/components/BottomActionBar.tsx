import type { ReactNode } from 'react';
import styles from './BottomActionBar.module.css';

export type BottomActionBarProps = {
  /** 左側說明：主要按鈕不能按的原因或費用；id 讓按鈕用 aria-describedby 指過來 */
  note?: string | undefined;
  noteId?: string;
  /** 左側放更多內容（例如待處理清單）；有傳就取代 note */
  lead?: ReactNode;
  /** 右側：主要按鈕 */
  children: ReactNode;
};

/** 黏在畫面底部的操作列 */
export function BottomActionBar({ note, noteId, lead, children }: BottomActionBarProps) {
  return (
    <div className={styles.bar}>
      {lead && <div className={styles.lead}>{lead}</div>}
      {!lead && note && (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      )}
      <div className={styles.actions}>{children}</div>
    </div>
  );
}
