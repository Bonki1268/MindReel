import { QUICK_TAGS, applyQuickTag } from '@templeyard/shared';
import { ArrowUp, ImageIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useAiAssist } from '../assist/useAiAssist';
import styles from './HomePanel.module.css';

type HomePanelProps = {
  videoId: string;
  templeName: string;
  /** 已帶入這支影片的寺廟照片張數 */
  photoCount: number;
  sending: boolean;
  onSend: (content: string) => void;
};

/** 創作首頁：置中的標題、一個大輸入框與快捷標籤（規格書「3. 創作對話」、設計稿 ChatHome） */
export function HomePanel({ videoId, templeName, photoCount, sending, onSend }: HomePanelProps) {
  const titleId = useId();
  const inputId = useId();
  const [input, setInput] = useState('');
  const assist = useAiAssist({
    field: 'creative.input',
    fieldLabel: '你想創作什麼',
    videoId,
    userInput: () => input,
    onAdopt: setInput,
  });
  const canSend = !sending && input.trim() !== '';

  return (
    <section className={styles.home} aria-labelledby={titleId}>
      <div className={styles.thumb} aria-hidden="true" />
      <h2 id={titleId} className={styles.title}>
        你想為{templeName}創作什麼？
      </h2>
      <div className={styles.composer}>
        <label className={styles.visuallyHidden} htmlFor={inputId}>
          你想創作什麼
        </label>
        <textarea
          id={inputId}
          className={styles.input}
          rows={3}
          maxLength={2000}
          placeholder="一句話就可以，例如「講媽祖顯靈救漁民的故事」；也可以貼上一整段故事。"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <div className={styles.bar}>
          {photoCount > 0 && (
            <span className={styles.chip}>
              <ImageIcon size={14} strokeWidth={1.8} aria-hidden="true" />
              寺廟照片 {photoCount} 張已帶入
            </span>
          )}
          <span className={styles.spacer} />
          {assist.button}
          <button type="button" className={styles.send} aria-label="送出" disabled={!canSend} onClick={() => onSend(input.trim())}>
            <ArrowUp size={22} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
      {assist.panel}
      <div className={styles.tags} role="group" aria-label="快捷標籤">
        {QUICK_TAGS.map((tag) => (
          <button key={tag} type="button" className={styles.tag} onClick={() => setInput((current) => applyQuickTag(current, tag, templeName))}>
            {tag}
          </button>
        ))}
      </div>
    </section>
  );
}
