'use client'

import { useId, useRef, useState, useTransition, type ReactNode } from 'react'
import { toast } from '@heroui/react'

export default function ActionForm({ action, successMessage, resetOnSuccess = false, className, children }: {
  action: (formData: FormData) => Promise<{ error?: string | null; success?: string }>
  successMessage: string
  resetOnSuccess?: boolean
  className?: string
  children: ReactNode
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const errorId = useId()

  return <form aria-busy={pending} aria-describedby={error ? errorId : undefined} onSubmit={event => {
    event.preventDefault()
    if (submitting.current) return
    const form = event.currentTarget
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    // Capture before disabling controls, including which approve/reject button
    // submitted the form. Keep all values intact if the action fails.
    const formData = new FormData(form, submitter)
    const message = submitter?.getAttribute('data-success-message') ?? successMessage
    submitting.current = true
    setError(null)
    startTransition(async () => {
      try {
        const result = await action(formData)
        if (result.error) {
          setError(result.error)
          toast.danger(result.error)
          return
        }
        toast.success(result.success ?? message)
        if (resetOnSuccess) form.reset()
      } catch {
        const message = 'ยังยืนยันผลไม่ได้ กรุณาตรวจสอบข้อมูลก่อนลองอีกครั้ง'
        setError(message)
        toast.danger(message)
      } finally {
        submitting.current = false
      }
    })
  }}>
    <fieldset disabled={pending} className={className}>
      {children}
      {pending && <span role="status" className="sr-only">กำลังดำเนินการ</span>}
      {error && <p id={errorId} role="alert" className="w-full rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p>}
    </fieldset>
  </form>
}

export { ActionForm }
