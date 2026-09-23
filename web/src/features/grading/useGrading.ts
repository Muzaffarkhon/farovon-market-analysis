import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { gradingApi } from '../../api/grading';
import { ApiError } from '../../api/client';
import { useToast } from '../../design/Toast';

/** Блок — в пути (`/grading/:block?`), как вкладка дашборда: ссылку на конкретный блок можно переслать. */
export function useGrading() {
  const { block = '' } = useParams<{ block?: string }>();
  const toast = useToast();
  const qc = useQueryClient();

  const blocks = useQuery({ queryKey: ['grading-blocks'], queryFn: () => gradingApi.blocks() });
  const factors = useQuery({
    queryKey: ['grading-factors', block],
    queryFn: () => gradingApi.factors(block ? 'block:' + block : undefined),
    enabled: !!block
  });
  const positions = useQuery({
    queryKey: ['grading-positions', block],
    queryFn: () => gradingApi.positions(block),
    enabled: !!block
  });

  const evaluateMutation = useMutation({
    mutationFn: (a: { jobTitle: string; factors: number[]; notes?: string }) =>
      gradingApi.evaluate({ block, job_title: a.jobTitle, factors: a.factors, notes: a.notes }),
    onSuccess: (r) => {
      toast.show(r.message, r.finalized || (!r.pending && r.gradeLevel != null) ? 'ok' : 'info');
      void qc.invalidateQueries({ queryKey: ['grading-positions', block] });
      void qc.invalidateQueries({ queryKey: ['grading-blocks'] });
    },
    onError: (e) => toast.show(e instanceof ApiError ? e.message : 'Не удалось сохранить оценку', 'error')
  });

  return {
    block,
    blocks: blocks.data?.rows,
    blocksLoading: blocks.isLoading,
    blocksError: blocks.error as Error | null,
    factors: factors.data,
    positions: positions.data,
    positionsLoading: positions.isLoading,
    positionsError: positions.error as Error | null,
    evaluate: evaluateMutation.mutate,
    evaluating: evaluateMutation.isPending
  };
}
