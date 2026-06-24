import { Skeleton, SkeletonText, SkeletonCard } from '@vibesboard/web'

export function LoadingCard() {
  return (
    <div style={{ padding: 24, maxWidth: 360 }}>
      <div
        className="rounded-xl border border-[#e4e3e3] bg-card dark:border-[#344348]"
        style={{ padding: 20 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Skeleton className="size-10 rounded-full" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
        <SkeletonText lines={3} />
      </div>
    </div>
  )
}

export function TextLines() {
  return (
    <div style={{ padding: 24, maxWidth: 360 }}>
      <SkeletonText lines={4} />
    </div>
  )
}

export function CardVariant() {
  return (
    <div style={{ padding: 24, maxWidth: 360 }}>
      <SkeletonCard />
    </div>
  )
}
