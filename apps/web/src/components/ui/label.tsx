// shadcn/ui label (new-york). Radix Label 대신 <label>
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-sm leading-none font-medium select-none', className)}
      {...props}
    />
  )
}
