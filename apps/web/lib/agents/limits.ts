import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'

/**
 * Atomically check the agent's lifetime response cap and, if within the limit,
 * increment the counter to reserve the slot.
 *
 * Returns true  — slot reserved, caller may proceed.
 * Returns false — limit reached, caller should return 403.
 *
 * Using a Firestore transaction ensures concurrent requests cannot both pass
 * the check and both serve a response over the cap.
 *
 * Note: if the request errors after this point the slot is still consumed.
 * That is an acceptable trade-off — it is better to occasionally lose one
 * slot to a failed request than to serve responses over the limit.
 */
export async function reserveAgentResponseSlot(
  tenantId: string,
  agentId: string,
  maxAgentResponses: number
): Promise<boolean> {
  const agentRef = adminDb.collection(Collections.agents(tenantId)).doc(agentId)

  let slotReserved = false

  await adminDb.runTransaction(async (tx: any) => {
    const snap = await tx.get(agentRef)
    const count =
      (snap.data() as Record<string, any> | undefined)?.totalResponseCount ?? 0
    if (count < maxAgentResponses) {
      tx.update(agentRef, { totalResponseCount: count + 1 })
      slotReserved = true
    }
  })

  return slotReserved
}
