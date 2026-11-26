import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  characterBlockers,
  checkPlan,
  estimateDialogueSec,
  missingViewName,
  missingViews,
  planVersionLabel,
  withTimeline,
  type Plan,
  type PlanResponse,
  type Shot,
  type ShotInput,
} from '@templeyard/shared';
import { Plus, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiRequestError, addSupplementalView, confirmSupplementalView, fetchPlanVersion, generateFrames, postPlanVersion } from '../../api/client';
import { askNotificationPermission } from '../frames/notify';
import { notificationApi } from '../frames/useFrameNotification';
import { Tag } from '../../components/Tag';
import { BottomActionBar } from '../../components/BottomActionBar';
import { StudioFooter } from '../studio/StudioFooter';
import { useCostConsent } from '../costs/useCostConsent';
import { CharacterCard } from './CharacterCard';
import { Button } from '../../components/Button';
import { addShot, duplicateShot, moveShot, removeShot, toInputs, withDurations } from './planEditor';
import styles from './PlanPanel.module.css';
import { ShotCard } from './ShotCard';
import { Timeline } from './Timeline';

export function planKey(videoId: string) {
  return ['plan', videoId] as const;
}

type PlanPanelProps = {
  videoId: string;
  data: PlanResponse & { plan: Plan };
  seriesVisualStyle: string;
  /** 這支影片的圖片模型（補充視角與精緻圖的費用） */
  imageModel: string;
  /** 送出精緻圖生成後（切到精緻圖面板） */
  onFramesStarted: () => void;
  /** 最近一次存成的版本（放在上層：存檔後面板會以新版本重新開始） */
  savedVersion: number | null;
  onSaved: (version: number) => void;
};

/** 畫面上顯示用：送出前的卡片也要有序號、時間與估時 */
function preview(inputs: readonly ShotInput[], saved: readonly Shot[]): Shot[] {
  return withTimeline(inputs).map((input, index) => ({
    shotKey: input.shotKey ?? `new-${index}`,
    seq: input.seq,
    startSec: input.startSec,
    durationSec: input.durationSec,
    shotSize: input.shotSize,
    cameraMove: input.cameraMove ?? saved[index]?.cameraMove ?? '固定',
    cameraSpeed: input.cameraSpeed ?? '',
    cameraAngle: input.cameraAngle ?? '',
    description: input.description ?? '',
    actionStart: input.actionStart ?? '',
    actionEnd: input.actionEnd ?? '',
    viewKey: input.viewKey ?? '',
    lighting: input.lighting ?? '',
    characters: input.characters ?? [],
    dialogue: input.dialogue ?? '',
    speaker: input.speaker ?? '',
    subtitle: input.subtitle ?? '',
    photoId: input.photoId ?? null,
    keyframesEnabled: input.keyframesEnabled ?? false,
    keyframeTimes: input.keyframeTimes ?? [],
    customPrompt: input.customPrompt ?? null,
    factSources: input.factSources ?? [],
    dialogueEstimateSec: estimateDialogueSec(input.dialogue ?? ''),
  }));
}

/**
 * 分鏡方案面板：上方風格、角色、場景三張卡；中間時間軸；下方分鏡卡片；底部列出還不能生成的原因。
 * 上層以現行版本當 key：版本換了（存檔、對話修改、回到舊版）就從新的版本重新開始編輯。
 */
export function PlanPanel({ videoId, data, seriesVisualStyle, imageModel, savedVersion, onSaved, onFramesStarted }: PlanPanelProps) {
  const titleId = useId();
  const versionSelectId = useId();
  const queryClient = useQueryClient();
  const current = data.plan;
  const [selected, setSelected] = useState(current.version);
  const [drafts, setDrafts] = useState<ShotInput[]>(() => toInputs(current.shots));
  const dragFrom = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const old = useQuery({
    queryKey: ['plan-version', videoId, selected],
    queryFn: () => fetchPlanVersion(videoId, selected),
    enabled: selected !== current.version,
  });

  const save = useMutation({
    mutationFn: (input: { shots?: ShotInput[]; revertTo?: number }) => postPlanVersion(videoId, { baseVersion: current.version, ...input }),
    onSuccess: async (plan) => {
      onSaved(plan.version);
      await queryClient.invalidateQueries({ queryKey: planKey(videoId) });
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: planKey(videoId) });
    },
  });

  function commit(next: ShotInput[]) {
    setDrafts(next);
    save.mutate({ shots: next });
  }

  /** 時間軸拖曳：畫面先跟著動，停下來 0.6 秒後才存成新版本 */
  function changeDurations(durations: number[]) {
    const next = withDurations(drafts, durations);
    setDrafts(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate({ shots: next }), 600);
  }

  const viewingOld = selected !== current.version;
  const shots = viewingOld ? (old.data?.shots ?? []) : preview(drafts, current.shots);
  const check = checkPlan(shots, data.rules);
  // 第 9 階段起「生成」開放：只剩秒數檢查與角色確認的原因
  const blockers = [...checkPlan(preview(drafts, current.shots), data.rules).blocking, ...characterBlockers(data.characters)];
  const frameCount = current.shots.reduce((sum, shot) => sum + (shot.keyframesEnabled ? 2 : 1), 0);
  const generateConsent = useCostConsent(videoId);

  function generate() {
    void askNotificationPermission(notificationApi());
    void generateConsent.ask({
      items: [{ model: imageModel, units: frameCount }],
      confirmLabel: '同意並生成',
      run: async (consentToken) => {
        await generateFrames(videoId, consentToken);
        onFramesStarted();
      },
    });
  }
  const missing = missingViews(shots);
  const sceneConsent = useCostConsent(videoId);
  const confirmView = useMutation({ mutationFn: (viewKey: string) => confirmSupplementalView(videoId, viewKey), onSettled: refresh });
  const sceneBusy = sceneConsent.busy || confirmView.isPending;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: planKey(videoId) });
  }

  function supplement(name: string) {
    void sceneConsent.ask({
      items: [{ model: imageModel, units: 1 }],
      confirmLabel: '同意並產生',
      run: async (consentToken) => {
        await addSupplementalView(videoId, name, consentToken);
        await refresh();
      },
    });
  }
  const busy = save.isPending;

  const flags: Record<string, 'error' | 'warning'> = {};
  for (const shot of shots) {
    if (check.shots[shot.shotKey]?.dialogueOverflow) flags[shot.shotKey] = 'error';
    else if (missingViewName(shot.viewKey)) flags[shot.shotKey] = 'warning';
  }

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.panelTitle}>
          分鏡方案
        </h2>
        <div className={styles.versions}>
          <label htmlFor={versionSelectId}>版本</label>
          <select id={versionSelectId} aria-label="方案版本" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
            {[...data.versions].reverse().map((version) => (
              <option key={version.version} value={version.version}>
                {planVersionLabel(version)}
              </option>
            ))}
          </select>
          {viewingOld && (
            <Button disabled={busy || !old.data} onClick={() => save.mutate({ revertTo: selected })}>
              回到這一版
            </Button>
          )}
        </div>
      </div>
      {viewingOld && <p className={styles.notice}>正在看舊的版本；按「回到這一版」會另存為新版本，不會覆蓋。</p>}
      <p className={styles.status} role="status">
        {savedVersion !== null && !busy ? `已存成第 ${savedVersion} 版` : ''}
      </p>
      {save.isError && (
        <p className={styles.error} role="alert">
          修改沒有存到：{save.error instanceof ApiRequestError ? save.error.message : '請再試一次'}
        </p>
      )}

      <div className={styles.overview}>
        <section className={styles.overviewCard} aria-label="風格">
          <h3 className={styles.overviewTitle}>外觀與風格</h3>
          <p>{seriesVisualStyle}</p>
          <p className={styles.meta}>{current.styleNote}</p>
        </section>
        <section className={styles.overviewCard} aria-label="角色">
          <h3 className={styles.overviewTitle}>角色</h3>
          {data.characters.length === 0 ? (
            <p className={styles.meta}>這版方案沒有角色</p>
          ) : (
            data.characters.map((character) => <CharacterCard key={`${character.id}-${character.version.id}`} videoId={videoId} character={character} onChanged={refresh} />)
          )}
        </section>
        <section className={styles.overviewCard} aria-label="場景">
          <h3 className={styles.overviewTitle}>場景・寺廟定裝版</h3>
          <ul className={styles.views}>
            {data.views.map((view) => (
              <li key={view.viewKey} className={styles.viewItem}>
                <span className={styles.viewThumb} aria-hidden="true" />
                <span className={styles.viewName}>{view.viewName}</span>
                {view.state === 'generating' && <Tag tone="info">生成中</Tag>}
                {view.state === 'failed' && <Tag tone="error">生成失敗</Tag>}
                {view.state === 'ready' && view.source === 'ai_inferred' && (
                  <Tag tone={view.confirmed ? 'success' : 'warning'}>{view.confirmed ? 'AI 推測・已確認' : 'AI 推測・待確認'}</Tag>
                )}
                {view.viewKey.startsWith('custom:') && view.state === 'ready' && !view.confirmed && (
                  <Button disabled={sceneBusy} onClick={() => confirmView.mutate(view.viewKey)}>
                    {`確認視角：${view.viewName}`}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {missing.map((name) => (
            <div key={`missing-${name}`} className={styles.missingView}>
              <span>{`缺少視角：${name}`}</span>
              <Button disabled={sceneBusy || viewingOld} onClick={() => supplement(name)}>
                {`補充視角：${name}`}
              </Button>
            </div>
          ))}
          {(sceneConsent.error || confirmView.isError) && (
            <p className={styles.error} role="alert">
              {sceneConsent.error ?? (confirmView.error instanceof ApiRequestError ? confirmView.error.message : '請再試一次')}
            </p>
          )}
          {sceneConsent.dialog}
        </section>
      </div>

      <Timeline shots={shots} totalSec={check.totalSec} targetSec={check.targetSec} flags={flags} onChange={changeDurations} disabled={viewingOld || busy} />

      <ol className={styles.cards} aria-label="分鏡卡片">
        {shots.map((shot, index) => (
          <li key={`${current.version}-${selected}-${shot.shotKey}-${index}`}>
            <ShotCard
              videoId={videoId}
              shot={shot}
              check={check.shots[shot.shotKey]}
              views={data.views}
              index={index}
              count={shots.length}
              readOnly={viewingOld}
              busy={busy}
              onChange={(patch) => commit(drafts.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))}
              onMove={(to) => commit(moveShot(drafts, index, to))}
              onDuplicate={() => commit(duplicateShot(drafts, index))}
              onRemove={() => commit(removeShot(drafts, index))}
              onDragStart={() => {
                dragFrom.current = index;
              }}
              onDrop={() => {
                const from = dragFrom.current;
                dragFrom.current = null;
                if (from !== null && from !== index) commit(moveShot(drafts, from, index));
              }}
            />
          </li>
        ))}
      </ol>
      {!viewingOld && (
        <button type="button" className={styles.addShot} disabled={busy} onClick={() => commit(addShot(drafts))}>
          <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
          新增一格
        </button>
      )}
      {generateConsent.error && (
        <p className={styles.error} role="alert">
          生成失敗：{generateConsent.error}
        </p>
      )}
      {generateConsent.dialog}

      <StudioFooter>
        <BottomActionBar
          lead={
          <div className={styles.generateInfo}>
            {blockers.length > 0 ? (
              <div className={styles.blockerRow}>
                <p className={styles.blockerHead}>
                  <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
                  {`還有 ${blockers.length} 項待處理：`}
                </p>
                <ul className={styles.blockers} aria-label="還不能生成的原因">
                  {blockers.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.blockerOk}>{`秒數檢查與角色都通過了，按「生成」產生 ${frameCount} 張精緻圖。`}</p>
            )}
            <p className={styles.cost}>費用預估：精緻圖 {frameCount} 張；按下「生成」後會先列出金額，你同意才開始</p>
          </div>
          }
        >
          <Button variant="primary" disabled={blockers.length > 0 || viewingOld || busy || generateConsent.busy} onClick={generate}>
            生成
          </Button>
        </BottomActionBar>
      </StudioFooter>
    </section>
  );
}
