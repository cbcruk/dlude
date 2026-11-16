// shadcn/ui alert (new-york), destructive만
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Alert({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn('bg-card text-destructive relative w-full rounded-lg border px-4 py-3 text-sm', className)}
      {...props}
    />
  )
}
