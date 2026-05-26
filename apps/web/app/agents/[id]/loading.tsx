import { Skeleton } from '@/components/ui/skeleton'

export default function AgentDetailLoading() {
  return (
    <div className="flex h-full">
      {/* Sidebar placeholder */}
      <div className="hidden w-[300px] shrink-0 border-r border-[#e4e3e3] p-4 dark:border-[#344348] lg:block">
        <Skeleton className="mb-4 h-10 w-full" />
        <Skeleton className="mb-6 h-8 w-full" />
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      {/* Main content placeholder */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-2xl space-y-4 px-4">
          <Skeleton className="mx-auto h-10 w-48" />
          <Skeleton className="mx-auto h-5 w-72" />
          <Skeleton className="mx-auto mt-8 h-12 w-full max-w-xl" />
        </div>
      </div>
    </div>
  )
}
