import { useQuery } from "@tanstack/react-query"
import { ExperimentsService, type TrialSummary } from "@/client"

// The platform has no video->trial link for library videos, so the only
// available signal is an exact video file name among trials the account may
// already read. Callers must label this as an unverified match.
async function authorizedTrials(signal?: AbortSignal): Promise<TrialSummary[]> {
  const experiments = (await ExperimentsService.listExperiments({ signal }))
    .data.data
  const trials: TrialSummary[] = []
  for (const experiment of experiments) {
    for (let skip = 0; skip < 2000; skip += 100) {
      const page = (
        await ExperimentsService.listTrials({
          path: { experiment_id: experiment.id },
          query: { skip, limit: 100 },
          signal,
        })
      ).data
      trials.push(...page.data)
      if (skip + 100 >= page.count) break
    }
  }
  return trials
}

export function useTrialByVideoName(
  filename: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["authorized-trials"],
    enabled: enabled && !!filename,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: ({ signal }) => authorizedTrials(signal),
    select: (trials) =>
      trials.find((trial) => trial.video_name === filename) ?? null,
  })
}
