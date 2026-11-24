import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CandidateComment,
  CreateCandidateCommentInput,
  ListCandidateCommentsResponse,
} from '@opushr/shared';
import { apiFetch } from '@/lib/http';

export function useCandidateComments(candidateId: string | undefined) {
  return useQuery({
    queryKey: ['candidate-comments', candidateId],
    queryFn: () =>
      apiFetch<ListCandidateCommentsResponse>(`/candidates/${candidateId}/comments`),
    enabled: !!candidateId,
  });
}

export function useCreateCandidateComment(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCandidateCommentInput) =>
      apiFetch<CandidateComment>(`/candidates/${candidateId}/comments`, {
        method: 'POST',
        body: input,
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidate-comments', candidateId] });
      // 2026-07-10 — the list rows carry commentsCount + lastCommentBody
      // (scalar subqueries). Without this invalidation the 60s staleTime kept
      // showing "no comments" in the list right after adding one (client
      // report: "sometimes comments don't show").
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useDeleteCandidateComment(candidateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      apiFetch<null>(`/candidates/${candidateId}/comments/${commentId}`, {
        method: 'DELETE',
      }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['candidate-comments', candidateId] });
      // Same as create — keep the list's comments column in sync.
      void qc.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}
