import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { ApiRequestError, postSeries } from '../../api/client';
import { BottomActionBar } from '../../components/BottomActionBar';
import { Button } from '../../components/Button';
import { OptionGroup } from '../../components/OptionGroup';
import styles from './SeriesCreateForm.module.css';
import { DEFAULT_SCENARIO_PACK, directionsFor, reconcileDirection } from './scenarioPackForm';
import { SeriesFields } from './SeriesFields';
import { initialSeriesForm, pendingItems, pendingMessage, toCreateSeriesInput, type SeriesFormState } from './seriesForm';
import { useScenarioPacks } from './useScenarioPacks';
import { SERIES_LIST_KEY } from './useSeriesList';

/** 建立新系列表單 */
export function SeriesCreateForm({ titleId }: { titleId: string }) {
  const [form, setForm] = useState<SeriesFormState>(initialSeriesForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // 情境包：建立後不能更改，所以只在建立時選
  const [scenarioPack, setScenarioPack] = useState(DEFAULT_SCENARIO_PACK);
  const packs = useScenarioPacks();
  const directions = directionsFor(packs.data?.find((pack) => pack.id === scenarioPack));
  const noteId = useId();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: postSeries,
    onSuccess: async () => {
      setForm(initialSeriesForm());
      setScenarioPack(DEFAULT_SCENARIO_PACK);
      setFieldErrors({});
      await queryClient.invalidateQueries({ queryKey: SERIES_LIST_KEY });
    },
    onError: (error) => {
      setFieldErrors(error instanceof ApiRequestError ? error.fieldErrors : {});
    },
  });

  const update = (patch: Partial<SeriesFormState>) => setForm((current) => ({ ...current, ...patch }));
  // 換情境包時，原本選的影片方向不在新選項裡就清掉
  const choosePack = (id: string) => {
    setScenarioPack(id);
    const next = directionsFor(packs.data?.find((pack) => pack.id === id));
    setForm((current) => reconcileDirection(current, next));
  };
  const pending = pendingItems(form);
  const note = pendingMessage(pending);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending.length > 0 || mutation.isPending) return;
    mutation.mutate({ ...toCreateSeriesInput(form), scenarioPack });
  };

  // 欄位層級以外的錯誤（例如連不上後端）
  const formError =
    mutation.isError && Object.keys(fieldErrors).length === 0 ? mutation.error.message : undefined;

  return (
    <form className={styles.form} aria-labelledby={titleId} onSubmit={submit} noValidate>
      <div className={styles.body}>
        <p className={styles.intro}>這些設定會套用到系列裡的每一支影片。</p>

        {packs.data && packs.data.length > 0 && (
          <OptionGroup
            legend="情境包"
            options={packs.data.map((pack) => ({ value: pack.id, label: pack.name }))}
            value={scenarioPack}
            onChange={choosePack}
          />
        )}
        {fieldErrors.scenarioPack && <p className={styles.alert}>{fieldErrors.scenarioPack}</p>}

        <SeriesFields form={form} update={update} fieldErrors={fieldErrors} directions={directions} />

        <p className={styles.note}>這個系列第一支影片送出的問卷答案，會存成系列的問卷預設值，之後的影片自動帶入。</p>

        {formError && (
          <p className={styles.alert} role="alert">
            {formError}
          </p>
        )}
      </div>

      <div className={styles.bar}>
        <BottomActionBar note={note || undefined} noteId={noteId}>
          <Button
            type="submit"
            variant="primary"
            disabled={pending.length > 0 || mutation.isPending}
            aria-describedby={note ? noteId : undefined}
            aria-busy={mutation.isPending || undefined}
          >
            建立系列
          </Button>
        </BottomActionBar>
      </div>
    </form>
  );
}
