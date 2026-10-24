import * as ProgressPrimitive from '@radix-ui/react-progress'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils'

// ---- Card ------------------------------------------------------------------------
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground', className)} {...p} />
}

// ---- Badge ------------------------------------------------------------------------
const badgeVariants = cva('inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px text-[12px] leading-[18px] whitespace-nowrap [&_svg]:size-3', {
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground',
      secondary: 'bg-[var(--tag-gray)] text-[var(--tag-gray-fg)]',
      outline: 'border border-border text-foreground',
      success: 'bg-[var(--tag-green)] text-[var(--tag-green-fg)]',
      warning: 'bg-[var(--tag-orange)] text-[var(--tag-orange-fg)]',
      destructive: 'bg-[var(--tag-red)] text-[var(--tag-red-fg)]',
      gold: 'bg-[var(--tag-purple)] text-[var(--tag-purple-fg)]',
      info: 'bg-[var(--tag-blue)] text-[var(--tag-blue-fg)]',
    },
  },
  defaultVariants: { variant: 'default' },
})
export function Badge({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />
}

// ---- Switch ------------------------------------------------------------------------
export function Switch({ className, ...p }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root className={cn('peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input', className)} {...p}>
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
}

// ---- Progress and skeleton --------------------------------------------------------
export function Progress({ className, value, indicatorClassName, ...p }: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)} {...p}>
      <ProgressPrimitive.Indicator className={cn('h-full w-full flex-1 bg-primary transition-transform duration-500', indicatorClassName)} style={{ transform: `translateX(-${100 - (value || 0)}%)` }} />
    </ProgressPrimitive.Root>
  )
}

export function Skeleton({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...p} />
}

// ---- Tabs ---------------------------------------------------------------------------------
export const Tabs = TabsPrimitive.Root
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  // One row that scrolls sideways on narrow screens instead of wrapping over the content below.
  return <TabsPrimitive.List className={cn('flex max-w-full items-end gap-1 overflow-x-auto overflow-y-hidden border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)} {...p} />
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn('inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 border-transparent px-2.5 text-[13px] font-medium text-muted-foreground transition-colors cursor-pointer hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.06] data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3.5', className)} {...p} />
}
export function TabsContent({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('mt-4 focus-visible:outline-none', className)} {...p} />
}

// ---- Tooltip -----------------------------------------------------------------------------------
/** Hover tooltip on desktop. On touch screens a tap on a non-interactive trigger (a label, badge or "?" icon) toggles it.
 *  The mouse passes through it, so it closes as soon as the pointer leaves the trigger, even when moving towards it. */
export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const [open, setOpen] = React.useState(false)
  const touch = React.useRef(false)
  if (!content) return <>{children}</>
  return (
    <TooltipPrimitive.Root delayDuration={200} open={open} onOpenChange={setOpen} disableHoverableContent>
      <TooltipPrimitive.Trigger asChild
        onPointerDown={(e) => { touch.current = e.pointerType === 'touch' }}
        onClick={(e) => {
          if (!touch.current || (e.currentTarget as HTMLElement).closest('a,button,input,select,label,textarea')) return
          e.preventDefault()  // keeps Radix from closing it again
          setOpen((o) => !o)
        }}>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} collisionPadding={12}
          className="pointer-events-none z-[100] max-w-[min(18rem,calc(100vw-24px))] rounded-md bg-[#0f0f0f] px-2.5 py-1.5 text-[12px] leading-snug text-white/90 shadow-lg animate-fade-in">
          {content}
          <TooltipPrimitive.Arrow className="fill-[#0f0f0f]" width={9} height={4} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
export const TooltipProvider = TooltipPrimitive.Provider

// ---- Table ----------------------------------------------------------------------------------------
export function Table({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) {
  return <div className="relative w-full overflow-x-auto"><table className={cn('w-full caption-bottom text-sm', className)} {...p} /></div>
}
export function THead({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('[&_tr]:border-b', className)} {...p} />
}
export function TBody({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />
}
export function TR({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-b transition-colors hover:bg-muted/50 data-[selected=true]:bg-muted', className)} {...p} />
}
export function TH({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('h-9 px-3 text-left align-middle text-xs font-normal text-muted-foreground whitespace-nowrap', className)} {...p} />
}
export function TD({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-middle', className)} {...p} />
}
