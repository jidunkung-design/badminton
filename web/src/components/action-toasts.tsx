'use client'

import { Toast } from '@heroui/react'

export function ActionToasts() {
  return <Toast.Provider placement="top end" width="min(380px, calc(100vw - 32px))" aria-label="ผลการดำเนินการ" />
}
