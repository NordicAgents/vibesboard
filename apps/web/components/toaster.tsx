'use client'

import { Toaster, ToastBar } from 'react-hot-toast'

// The render-prop child must live in a Client Component: functions cannot be
// serialised across the server/client boundary, so rendering <Toaster>{fn}</Toaster>
// directly from the root layout (a Server Component) throws at request time.
export function AppToaster() {
  return (
    <Toaster>
      {toast => (
        <ToastBar
          toast={{
            ...toast,
            ariaProps: {
              role: toast.type === 'error' ? 'alert' : 'status',
              'aria-live': toast.type === 'error' ? 'assertive' : 'polite'
            }
          }}
        />
      )}
    </Toaster>
  )
}
