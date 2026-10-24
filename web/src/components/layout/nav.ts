import { Activity, Grid3x3, Lightbulb, ListX, Scale, ScrollText } from 'lucide-react'

export type NavItem = { to: string; label: string; icon: typeof Activity; end?: boolean; hint?: string }

export const PAGES: NavItem[] = [
  { to: '/', label: 'Findings', icon: Lightbulb, end: true, hint: 'What the data says, one picture per question' },
  { to: '/run/status', label: 'Run status', icon: Activity, hint: 'Live progress and cost' },
  { to: '/run/matrix', label: 'Results matrix', icon: Grid3x3, hint: 'Every variant as one cell: model by setting by sample' },
  { to: '/run/failures', label: 'Faults and failures', icon: ListX, hint: 'Which tests fail, and which variants fail together' },
  { to: '/run/compare', label: 'Models and settings', icon: Scale, hint: 'Compile and pass rates, tokens, time and cost side by side' },
  { to: '/run/log', label: 'Run log', icon: ScrollText, hint: 'Every logged step of the generator, newest first' },
]
