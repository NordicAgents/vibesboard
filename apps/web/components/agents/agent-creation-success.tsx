'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { IconCheck } from '@/components/ui/icons'
import { Share2, Settings2 } from 'lucide-react'

interface AgentCreationSuccessProps {
  agentId: string
  agentName: string
}

export function AgentCreationSuccess({
  agentId,
  agentName
}: AgentCreationSuccessProps) {
  const router = useRouter()

  const navigate = (path: string) => {
    router.push(path)
    router.refresh()
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[#f7f7f5] p-6 dark:bg-[#222f30]">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-[#e4e3e3] bg-[#f5f8f7] p-10 text-center shadow-[0_8px_40px_rgba(0,0,0,0.10)] dark:border-[#344348] dark:bg-[#192425]">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{
            delay: 0.1,
            type: 'spring',
            stiffness: 260,
            damping: 20
          }}
          className="flex size-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
        >
          <IconCheck className="size-10 text-emerald-600 dark:text-emerald-400" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="space-y-2"
        >
          <h2 className="font-sans text-2xl font-medium tracking-tight text-[#222f30] dark:text-[#f5f8f7]">
            Your agent is ready!
          </h2>
          <p className="text-sm text-[#445e5f] dark:text-[#6f7f80]">
            <span className="font-medium text-[#222f30] dark:text-[#f5f8f7]">
              {agentName}
            </span>{' '}
            has been created. What would you like to do next?
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
          className="flex w-full flex-col gap-2.5"
        >
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => navigate(`/agents/${agentId}?tab=share`)}
              className="flex-1 gap-2"
            >
              <Share2 className="size-4" />
              Share Link
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/agents/${agentId}?tab=setup`)}
              className="flex-1 gap-2"
            >
              <Settings2 className="size-4" />
              Configure
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
