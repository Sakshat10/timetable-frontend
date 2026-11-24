"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scheduleApi } from "@/lib/api/endpoints";
import type { CreateScheduleBody, UpdateScheduleBody } from "@/lib/api/types";
import { qk } from "@/lib/query/keys";
import { invalidateGenerationInput } from "@/features/teachers/hooks";

export function useSchedule(yearId: string) {
  return useQuery({ queryKey: qk.schedule(yearId), queryFn: () => scheduleApi.list(yearId), select: (rows) => rows[0] ?? null });
}

function useAfterWrite(yearId: string) {
  const client = useQueryClient();
  return () => Promise.all([client.invalidateQueries({ queryKey: qk.schedule(yearId) }), invalidateGenerationInput(client, yearId)]);
}

export function useCreateSchedule(yearId: string) {
  const after = useAfterWrite(yearId);
  return useMutation({ mutationFn: (body: CreateScheduleBody) => scheduleApi.create(body), onSettled: after });
}

export function useUpdateSchedule(yearId: string) {
  const after = useAfterWrite(yearId);
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: UpdateScheduleBody }) => scheduleApi.update(id, body), onSettled: after });
}

export function useResetSchedule(yearId: string) {
  const after = useAfterWrite(yearId);
  return useMutation({ mutationFn: (id: string) => scheduleApi.reset(id), onSettled: after });
}
