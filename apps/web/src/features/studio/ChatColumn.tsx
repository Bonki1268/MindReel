import type { ChatMessage, ToolCallSummary } from '@templeyard/shared';
import { ArrowUp, ListChecks, TriangleAlert } from 'lucide-react';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import styles from './ChatColumn.module.css';
import type { LiveReply } from './useStudioChat';

type ChatColumnProps = {
  messages: ChatMessage[];
  live: LiveReply | null;
  sending: boolean;
  error: string | null;
  onSend: (content: string) => void;
  /** 輸入框的名稱；細修頁是「對 Agent 說（只針對這一格）」 */
  inputLabel?: string;
  /** 輸入框的提示文字 */
  placeholder?: string;
  /** 還沒有任何對話時，助理先說的一句話（不算一則訊息） */
  greeting?: string;
  /** 靠左側的整欄版面（創作工作區）：沒有外框，高度由上層決定 */
  rail?: boolean;
  /** 對話欄頂端的一行說明（例如「對話只針對第 4 格」） */
  heading?: string;
};

function ToolCalls({ calls }: { calls: ToolCallSummary[] }) {
  if (calls.length === 0) return null;
  return (
    <ul className={styles.tools} aria-label="Agent 做了">
      {calls.map((call, index) => (
        <li key={`${call.name}-${index}`}>
          <span className={call.ok ? styles.toolLabel : `${styles.toolLabel} ${styles.toolFailed}`}>
            {call.ok ? <ListChecks size={16} strokeWidth={1.8} aria-hidden="true" /> : <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />}
            {call.label}
          </span>
          <span className={styles.toolSummary}>{call.summary}</span>
        </li>
      ))}
    </ul>
  );
}

/** 一則訊息：多行內容每行一段（問卷答案摘要一題一行） */
function Bubble({ who, lines, calls }: { who: 'user' | 'agent'; lines: string[]; calls: ToolCallSummary[] }) {
  return (
    <article className={who === 'user' ? styles.user : styles.agent} aria-label={who === 'user' ? '我說' : 'Agent 說'}>
      {lines.map((line, index) => (
        <p key={index} className={styles.line}>
          {line}
        </p>
      ))}
      <ToolCalls calls={calls} />
    </article>
  );
}

/** 左欄：與創作 Agent 的對話；底部是輸入框與送出鈕（Enter 送出，Shift＋Enter 換行） */
export function ChatColumn({
  messages,
  live,
  sending,
  error,
  onSend,
  inputLabel = '對 Agent 說',
  placeholder = '傳訊息給創作助理…',
  greeting,
  rail = false,
  heading,
}: ChatColumnProps) {
  const [draft, setDraft] = useState('');
  const inputId = useId();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setDraft('');
    onSend(content);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  const empty = messages.length === 0 && !live;

  return (
    <aside className={rail ? `${styles.column} ${styles.rail}` : styles.column}>
      {heading && <p className={styles.heading}>{heading}</p>}
      <section className={styles.log} aria-label="對話">
        {empty && <p className={greeting ? styles.agentNote : styles.empty}>{greeting ?? '還沒有對話。在右邊說說你想為這間廟創作什麼。'}</p>}
        {messages.map((message) => (
          <Bubble key={message.id} who={message.role} lines={message.content.split('\n')} calls={message.toolCalls} />
        ))}
        {live && (live.text.length > 0 || live.toolCalls.length > 0) && <Bubble who="agent" lines={live.text} calls={live.toolCalls} />}
        {sending && (
          <p className={styles.status} role="status">
            Agent 正在回覆…
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </section>
      <form className={styles.composer} onSubmit={submit}>
        <label className={styles.visuallyHidden} htmlFor={inputId}>
          {inputLabel}
        </label>
        <textarea
          id={inputId}
          className={styles.input}
          rows={1}
          maxLength={2000}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className={styles.send} aria-label="傳送" disabled={sending || draft.trim() === ''}>
          <ArrowUp size={20} strokeWidth={2} aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}
