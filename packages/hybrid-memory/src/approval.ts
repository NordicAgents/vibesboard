import type { HybridStore, MutationFilter } from './interfaces/store.ts'
import type { PendingMutation } from './types.ts'
import { applyMutation } from './pipeline/reconcile.ts'

export async function getPendingMutations(
  filter: MutationFilter,
  store: HybridStore,
): Promise<PendingMutation[]> {
  return store.listMutations({ ...filter, status: 'pending' })
}

export async function approveMutation(id: string, store: HybridStore): Promise<void> {
  const mut = await store.getMutation(id)
  if (!mut || mut.status !== 'pending') return
  await applyMutation(mut.mutation, store)
  await store.updateMutationStatus(id, 'approved', new Date())
}

export async function rejectMutation(id: string, store: HybridStore): Promise<void> {
  const mut = await store.getMutation(id)
  if (!mut || mut.status !== 'pending') return
  await store.updateMutationStatus(id, 'rejected', new Date())
}
