import toast from 'react-hot-toast'

export function toastWithRetry(message: string, retryFn: () => void) {
  toast.error(
    t => (
      <div className="flex items-center gap-3">
        <span className="text-sm">{message}</span>
        <button
          onClick={() => {
            toast.dismiss(t.id)
            retryFn()
          }}
          className="shrink-0 text-xs font-medium text-accent-orange underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    ),
    { duration: 6000 }
  )
}
