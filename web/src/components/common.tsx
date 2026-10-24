import { Check, CircleHelp, Copy, WrapText, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Highlight, themes } from 'prism-react-renderer'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Card, Tooltip } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { GLOSSARY, type Term as TermId } from '@/lib/glossary'
import { type Language, languageOf, useIsDark } from '@/lib/highlight'
import { cn, int } from '@/lib/utils'

/** A word with a dotted underline; hovering shows its definition from the glossary. */
export function Term({ id, children, className }: { id: TermId; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip content={GLOSSARY[id]}>
      <span className={cn('cursor-help underline decoration-muted-foreground/50 decoration-dotted underline-offset-[3px]', className)}>{children}</span>
    </Tooltip>
  )
}

/** A small question mark that explains the thing next to it. */
export function InfoTip({ id, text, className }: { id?: TermId; text?: React.ReactNode; className?: string }) {
  return (
    <Tooltip content={text ?? (id ? GLOSSARY[id] : null)}>
      <span className={cn('inline-flex cursor-help align-middle text-muted-foreground/70 hover:text-foreground', className)} tabIndex={0}>
        <CircleHelp className="size-3.5" />
      </span>
    </Tooltip>
  )
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="break-words text-[22px] font-bold leading-tight tracking-[-0.01em] sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', term }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: LucideIcon; tone?: 'default' | 'gold' | 'success' | 'warning'; term?: TermId }) {
  const tones = { default: 'text-muted-foreground', gold: 'text-muted-foreground', success: 'text-success', warning: 'text-warning' }
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{label}{term && <InfoTip id={term} />}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {Icon && <Icon className={cn('size-4 shrink-0', tones[tone])} strokeWidth={1.75} />}
      </div>
    </Card>
  )
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed px-6 py-12 text-center">
      <Icon className="mb-3 size-5 text-muted-foreground" strokeWidth={1.75} />
      <div className="text-sm font-medium">{title}</div>
      {description && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = React.useState(false)
  return (
    <Tooltip content={done ? 'Copied' : 'Copy to clipboard'}>
      <Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200) }}>
        {done ? <Check className="text-success" /> : <Copy />}
      </Button>
    </Tooltip>
  )
}

const PAGE_LINES = 400  // long texts render in pages, so a 500 KB reasoning trace does not freeze a phone

export function CodeBlock({ code, title, language, maxHeight = '32rem', className }: { code: string; title?: string; language?: Language; maxHeight?: string; className?: string }) {
  const dark = useIsDark()
  const lang = language ?? languageOf(title)
  const text = code.replace(/\n$/, '')
  const allLines = React.useMemo(() => text.split('\n'), [text])
  const [wrap, setWrap] = React.useState(lang === 'text' || lang === 'markdown')
  const [shown, setShown] = React.useState(PAGE_LINES)
  const cut = allLines.length > shown
  const visible = cut ? allLines.slice(0, shown).join('\n') : text
  const plain = lang === 'text' || text.length > 200_000  // no highlighting for prose or very large files
  const lineClass = 'flex hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
  const num = (n: number) => <span className="w-9 shrink-0 select-none pr-2 text-right text-muted-foreground/50 sm:w-12 sm:pr-3">{n}</span>
  const body = cn('pr-4', wrap ? 'min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'whitespace-pre')
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-muted/60', className)}>
      <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{title ?? `${allLines.length} lines`}</span>
        <span className="flex shrink-0 items-center gap-1">
          {lang !== 'text' && <span className="hidden text-[11px] text-muted-foreground sm:inline">{LANGUAGE_NAME[lang]}</span>}
          <Tooltip content={wrap ? 'Show long lines on one line (scroll sideways)' : 'Wrap long lines to fit the screen'}>
            <Button variant="ghost" size="icon-sm" onClick={() => setWrap(!wrap)} aria-label="Wrap lines" className={cn(wrap && 'text-primary')}><WrapText /></Button>
          </Tooltip>
          <CopyButton text={code} />
        </span>
      </div>
      <div className="overflow-auto overscroll-contain" style={{ maxHeight }}>
        {plain ? (
          <pre className="py-1 font-mono text-[12px] leading-5">
            {(cut ? allLines.slice(0, shown) : allLines).map((line, i) => (
              <div key={i} className={lineClass}>{num(i + 1)}<span className={body}>{line || ' '}</span></div>
            ))}
          </pre>
        ) : (
          <Highlight code={visible} language={lang} theme={dark ? themes.oneDark : themes.oneLight}>
            {({ tokens, getLineProps, getTokenProps }) => (
              <pre className="py-1 font-mono text-[12px] leading-5">
                {tokens.map((line, i) => {
                  const { className: lc, ...lineProps } = getLineProps({ line })
                  return (
                    <div key={i} {...lineProps} className={cn(lc, lineClass)}>
                      {num(i + 1)}
                      <span className={body}>
                        {line.map((token, j) => {
                          const { style, ...tokenProps } = getTokenProps({ token })
                          return <span key={j} {...tokenProps} style={{ ...style, background: 'none' }} />
                        })}
                      </span>
                    </div>
                  )
                })}
              </pre>
            )}
          </Highlight>
        )}
        {cut && (
          <div className="sticky left-0 flex flex-wrap items-center gap-2 border-t bg-card px-3 py-2 text-xs text-muted-foreground">
            Showing {int(shown)} of {int(allLines.length)} lines.
            <Button variant="outline" size="xs" onClick={() => setShown(shown + PAGE_LINES * 5)}>Show more</Button>
            <Button variant="ghost" size="xs" onClick={() => setShown(allLines.length)}>Show all</Button>
          </div>
        )}
      </div>
    </div>
  )
}

const LANGUAGE_NAME: Record<Language, string> = {
  solidity: 'Solidity', typescript: 'TypeScript', java: 'Java', json: 'JSON', markdown: 'Markdown', python: 'Python', text: 'Text',
}

export function Markdown({ children }: { children: string }) {
  return <div className="prose-spec"><ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown></div>
}

/** Label and value rows. A third element explains the label on hover. */
export function KeyValue({ items, className }: { items: ([string, React.ReactNode] | [string, React.ReactNode, TermId])[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-0.5 text-sm sm:grid-cols-[max-content_1fr] sm:gap-y-2', className)}>
      {items.map(([k, v, term]) => (
        <React.Fragment key={k}>
          <dt className="text-xs text-muted-foreground max-sm:mt-2 max-sm:first:mt-0 sm:text-sm">{term ? <Term id={term}>{k}</Term> : k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function JsonView({ value, maxHeight = '28rem' }: { value: unknown; maxHeight?: string }) {
  const text = JSON.stringify(value, null, 2)
  return <CodeBlock code={text} title="JSON" maxHeight={maxHeight} />
}

export function Section({ title, description, children, actions, term }: { title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; term?: TermId }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">{title}{term && <InfoTip id={term} />}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
