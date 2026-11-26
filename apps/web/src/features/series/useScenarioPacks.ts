import { useQuery } from '@tanstack/react-query';
import { scenarioLabels, type ScenarioLabels, type ScenarioPackSummary } from '@templeyard/shared';
import { fetchScenarioPacks } from '../../api/client';

export const SCENARIO_PACKS_KEY = ['scenario-packs'] as const;

/** 情境包清單；很少改變，讀一次就好 */
export function useScenarioPacks() {
  return useQuery({ queryKey: SCENARIO_PACKS_KEY, queryFn: fetchScenarioPacks, staleTime: Infinity });
}

/** 某個系列的情境包（還沒讀到或找不到時是 undefined） */
export function useScenarioPack(packId: string | undefined): ScenarioPackSummary | undefined {
  const packs = useScenarioPacks();
  return packs.data?.find((pack) => pack.id === packId);
}

/** 某個系列的介面用詞；還沒讀到情境包時用廟埕包的用詞 */
export function useScenarioLabels(packId: string | undefined): ScenarioLabels {
  return scenarioLabels(useScenarioPack(packId));
}
