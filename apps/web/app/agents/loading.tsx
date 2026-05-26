import { SkeletonCard } from '@/components/ui/skeleton'

export default function AgentsLoading() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8">
        {/* Header skeleton */}
        <div className="space-y-2">
          <div className="skeleton h-8 w-40" />
          <div className="skeleton h-4 w-64" />
        </div>

        {/* Cards grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  )
}
