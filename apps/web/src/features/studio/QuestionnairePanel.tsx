import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ANSWER_SOURCE_LABELS,
  findQuestion,
  viewName,
  type AnswerSource,
  type Photo,
  type Question,
  type Questionnaire,
  type QuestionnaireAnswer,
} from '@templeyard/shared';
import { Pencil } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { assetUrl, generatePlan, putQuestionnaire } from '../../api/client';
import { Button } from '../../components/Button';
import { OptionGroup } from '../../components/OptionGroup';
import { TextField } from '../../components/TextField';
import { useAiAssist } from '../assist/useAiAssist';
import { planKey } from '../plan/PlanPanel';
import { StudioFooter } from './StudioFooter';
import { BottomActionBar } from '../../components/BottomActionBar';
import { videoDetailKey } from '../videos/useVideoDetail';
import { chooseOption, draftFrom, draftSource, toAnswerInput, togglePhoto, typeCustom, type DraftAnswer } from './questionnaireForm';
import styles from './QuestionnairePanel.module.css';
import { chatKey, questionnaireKey } from './useStudioChat';

/** 每題的答案來源：你的輸入是藍色標籤、系列預設是黃色標籤、還沒作答只用一般文字 */
function SourceTag({ source }: { source: AnswerSource }) {
  if (source === 'system') {
    return (
      <span className={styles.systemNote}>
        <span className={styles.noteLead}>未作答・</span>
        <span>{ANSWER_SOURCE_LABELS.system}</span>
      </span>
    );
  }
  return <span className={source === 'user' ? `${styles.badge} ${styles.badgeUser}` : `${styles.badge} ${styles.badgeDefault}`}>{ANSWER_SOURCE_LABELS[source]}</span>;
}

type QuestionProps = {
  videoId: string;
  question: Question;
  original: QuestionnaireAnswer;
  draft: DraftAnswer;
  photos: Photo[];
  onChange: (draft: DraftAnswer) => void;
};

/** 文字題（想講的故事、一定要說到的事）：輸入框＋AI 幫我寫 */
function TextQuestion({ videoId, question, original, draft, onChange }: QuestionProps) {
  const assist = useAiAssist({
    field: question.id === 'story' ? 'questionnaire.story' : 'questionnaire.mustSay',
    fieldLabel: question.title,
    videoId,
    target: { questionId: question.id },
    userInput: () => draft.custom,
    onAdopt: (text) => onChange(typeCustom(draft, text)),
  });
  return (
    <>
      <TextField
        label={question.title}
        value={draft.custom}
        onChange={(text) => onChange(typeCustom(draft, text))}
        multiline
        maxLength={500}
        labelAccessory={
          <span className={styles.accessory}>
            <SourceTag source={draftSource(original, draft)} />
            {assist.button}
          </span>
        }
      />
      {assist.panel}
    </>
  );
}

const OTHER_PLACEHOLDERS: Record<string, string> = {
  goal: '例如：讓年輕人知道，這間廟和討海人的關係',
  audience: '例如：帶小孩來參加遶境的家庭',
  narration: '用自己的話描述',
  character: '例如：阿嬤和她的孫子',
  tone: '例如：溫暖，結尾帶一點幽默',
  length: '秒數（30 以內）',
};

/** 選項題：點選項或自己寫，二擇一；再按一次選取的選項取消 */
function ChoiceQuestion({ videoId, question, original, draft, onChange }: QuestionProps) {
  const assist = useAiAssist({
    field: 'questionnaire.custom',
    fieldLabel: `${question.title}（或自己寫）`,
    videoId,
    target: { questionId: question.id },
    userInput: () => draft.custom,
    onAdopt: (text) => onChange(typeCustom(draft, text)),
  });
  return (
    <>
      <OptionGroup
        legend={question.title}
        legendAccessory={<SourceTag source={draftSource(original, draft)} />}
        options={question.options.map((option) => ({ value: option, label: option }))}
        value={draft.choice}
        onChange={(option) => onChange(chooseOption(draft, option))}
        other={{ value: draft.custom, onChange: (text) => onChange(typeCustom(draft, text)), accessory: assist.button, placeholder: OTHER_PLACEHOLDERS[question.id] ?? '用自己的話描述' }}
      />
      {assist.panel}
    </>
  );
}

/** 一定要出現的照片：勾選這支影片上傳的照片，每張有縮圖 */
function PhotoQuestion({ question, original, draft, photos, onChange }: QuestionProps) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{question.title}</legend>
      <div className={styles.legendAccessory}>
        <SourceTag source={draftSource(original, draft)} />
      </div>
      {photos.length === 0 && <p className={styles.muted}>這支影片還沒有照片。</p>}
      <div className={styles.photos}>
        {photos.map((photo, index) => {
          const checked = draft.photoIds.includes(photo.id);
          return (
            <label key={photo.id} className={styles.photo}>
              <img className={checked ? `${styles.photoThumb} ${styles.photoChecked}` : styles.photoThumb} src={assetUrl(photo.deidentifiedAssetId)} alt="" />
              <span className={styles.photoName}>
                <input type="checkbox" checked={checked} onChange={() => onChange(togglePhoto(draft, photo.id))} />
                照片 {index + 1}（{photo.viewKey ? viewName(photo.viewKey) : '沒有指定視角'}）
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type QuestionnairePanelProps = {
  videoId: string;
  questionnaire: Questionnaire;
  photos: Photo[];
  /** 已經有分鏡方案時，送出問卷不會重新產生 */
  hasPlan: boolean;
  /** 方案產生好了（第一次送出問卷）：切到方案面板 */
  onPlanReady: () => void;
};

/** 設定問卷：每題點選項或自己寫，留白由系統決定；按「建立分鏡方案」送出 */
export function QuestionnairePanel({ videoId, questionnaire, photos, hasPlan, onPlanReady }: QuestionnairePanelProps) {
  const titleId = useId();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>(() =>
    Object.fromEntries(questionnaire.answers.map((answer) => [answer.questionId, draftFrom(answer)])),
  );
  // 送出問卷；第一次送出（還沒有方案）時接著請 Agent 產生分鏡方案第 1 版
  const submit = useMutation({
    mutationFn: async () => {
      await putQuestionnaire(
        videoId,
        questionnaire.answers.map((answer) => toAnswerInput(answer.questionId, drafts[answer.questionId] ?? draftFrom(answer))),
      );
      if (!hasPlan) await generatePlan(videoId);
    },
    onSettled: async (_data, error) => {
      if (!error && !hasPlan) onPlanReady();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKey(videoId) }),
        queryClient.invalidateQueries({ queryKey: questionnaireKey(videoId) }),
        queryClient.invalidateQueries({ queryKey: planKey(videoId) }),
        queryClient.invalidateQueries({ queryKey: videoDetailKey(videoId) }),
      ]);
    },
  });

  const cards = questionnaire.answers.flatMap((answer) => {
    const question = findQuestion(answer.questionId);
    if (!question) return [];
    const props: QuestionProps = {
      videoId,
      question,
      original: answer,
      draft: drafts[answer.questionId] ?? draftFrom(answer),
      photos,
      onChange: (draft) => setDrafts((old) => ({ ...old, [answer.questionId]: draft })),
    };
    const card = (
      <section key={question.id} className={styles.question} aria-label={`問卷題目：${question.title}`}>
        {question.kind === 'choice' && <ChoiceQuestion {...props} />}
        {question.kind === 'text' && <TextQuestion {...props} />}
        {question.kind === 'photos' && <PhotoQuestion {...props} />}
      </section>
    );
    return [{ id: question.id, card }];
  });
  // 故事怎麼說、角色、語氣、長度四題兩三欄並排；其他題各占一整列
  const compact = new Set(['narration', 'character', 'tone', 'length']);
  const blocks: { key: string; nodes: ReactNode[]; grid: boolean }[] = [];
  for (const item of cards) {
    const grid = compact.has(item.id);
    const last = blocks.at(-1);
    if (last && last.grid === grid && grid) last.nodes.push(item.card);
    else blocks.push({ key: item.id, nodes: [item.card], grid });
  }

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.panelTitle}>
          設定問卷
        </h2>
        <p className={styles.lead}>每一題都可以點選項，或用自己的話寫。留白的題目由系統決定，並在分鏡方案中說明選了什麼。</p>
      </div>
      {blocks.map((block) => (block.grid ? <div key={block.key} className={styles.grid}>{block.nodes}</div> : block.nodes))}
      {submit.isError && (
        <p className={styles.error} role="alert">
          {hasPlan ? '送出問卷失敗' : '送出問卷或產生分鏡方案失敗'}：{submit.error.message}
        </p>
      )}
      {submit.isPending && (
        <p className={styles.notice} role="status">
          {hasPlan ? '正在送出問卷…' : '正在送出問卷，Agent 接著排分鏡方案…'}
        </p>
      )}
      <StudioFooter>
        <BottomActionBar note="送出後依這些答案排分鏡方案，不會產生費用">
          <Button variant="primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
            <Pencil size={18} strokeWidth={1.8} aria-hidden="true" />
            建立分鏡方案
          </Button>
        </BottomActionBar>
      </StudioFooter>
    </section>
  );
}
