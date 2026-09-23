import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { benchmarkApi } from '../../../api/benchmark';
import { ApiError } from '../../../api/client';
import type {
  CreateSourcePayload, UpdateSourcePayload, SaveMappingPayload, BenchmarkImportRequest
} from '../../../api/contract';
import { useToast } from '../../../design/Toast';

export function useSources() {
  const toast = useToast();
  const qc = useQueryClient();
  const sources = useQuery({ queryKey: ['admin-benchmark-sources'], queryFn: () => benchmarkApi.sources() });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin-benchmark-sources'] });

  const create = useMutation({
    mutationFn: (p: CreateSourcePayload) => benchmarkApi.createSource(p),
    onSuccess: () => { toast.show('Источник создан', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось создать источник', 'error')
  });

  const update = useMutation({
    mutationFn: (p: UpdateSourcePayload) => benchmarkApi.updateSource(p),
    onSuccess: () => { toast.show('Источник обновлён', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось изменить источник', 'error')
  });

  const setWeights = useMutation({
    mutationFn: (weights: Record<string, number>) => benchmarkApi.setSourceWeights(weights),
    onSuccess: () => { toast.show('Веса сохранены', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить веса', 'error')
  });

  return {
    sources: sources.data?.sources, loading: sources.isLoading, error: sources.error as Error | null,
    create: create.mutate, update: update.mutate, setWeights: setWeights.mutate
  };
}

export function useDatasets(sourceKey?: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const datasets = useQuery({ queryKey: ['admin-benchmark-datasets', sourceKey], queryFn: () => benchmarkApi.datasets(sourceKey) });

  const remove = useMutation({
    mutationFn: (id: number) => benchmarkApi.deleteDataset(id),
    onSuccess: r => { toast.show(r.message, 'ok'); void qc.invalidateQueries({ queryKey: ['admin-benchmark-datasets'] }); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить датасет', 'error')
  });

  return { datasets: datasets.data?.datasets, loading: datasets.isLoading, error: datasets.error as Error | null, remove: remove.mutate };
}

export function useMappings(sourceKey: string) {
  const toast = useToast();
  const qc = useQueryClient();
  const mappings = useQuery({ queryKey: ['admin-benchmark-mappings', sourceKey], queryFn: () => benchmarkApi.mappings(sourceKey), enabled: !!sourceKey });
  const suggestions = useQuery({ queryKey: ['admin-benchmark-suggestions', sourceKey], queryFn: () => benchmarkApi.suggestMappings(sourceKey), enabled: !!sourceKey });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin-benchmark-mappings', sourceKey] });
    void qc.invalidateQueries({ queryKey: ['admin-benchmark-suggestions', sourceKey] });
  };

  const save = useMutation({
    mutationFn: (p: SaveMappingPayload) => benchmarkApi.saveMapping(p),
    onSuccess: () => { toast.show('Сопоставление сохранено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить сопоставление', 'error')
  });

  const remove = useMutation({
    mutationFn: (id: number) => benchmarkApi.deleteMapping(id),
    onSuccess: () => { toast.show('Сопоставление удалено', 'ok'); invalidate(); },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось удалить сопоставление', 'error')
  });

  return {
    mappings: mappings.data?.mappings, mappingsLoading: mappings.isLoading,
    suggestions: suggestions.data?.suggestions, suggestionsLoading: suggestions.isLoading,
    save: save.mutate, remove: remove.mutate
  };
}

export function useImportWizard() {
  const toast = useToast();
  const qc = useQueryClient();

  const xlsxSheets = useMutation({
    mutationFn: (fileBase64: string) => benchmarkApi.xlsxSheets(fileBase64),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось прочитать файл', 'error')
  });

  const xlsxGrid = useMutation({
    mutationFn: (a: { fileBase64: string; sheet: string }) => benchmarkApi.xlsxGrid(a.fileBase64, a.sheet),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось прочитать лист', 'error')
  });

  const dryRun = useMutation({
    mutationFn: (p: BenchmarkImportRequest) => benchmarkApi.importDryRun(p),
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось проверить файл', 'error')
  });

  const commit = useMutation({
    mutationFn: (p: BenchmarkImportRequest & { methodology?: string }) => benchmarkApi.importCommit(p),
    onSuccess: r => {
      toast.show(r.message, 'ok');
      void qc.invalidateQueries({ queryKey: ['admin-benchmark-datasets'] });
    },
    onError: e => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить датасет', 'error')
  });

  return {
    xlsxSheets: xlsxSheets.mutateAsync,
    xlsxGrid: xlsxGrid.mutateAsync,
    dryRun: dryRun.mutateAsync, dryRunPending: dryRun.isPending,
    commit: commit.mutate, committing: commit.isPending
  };
}
