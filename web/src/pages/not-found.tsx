import { Compass } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <EmptyState icon={Compass} title="Page not found" description={`There is no page at ${pathname}. Use the menu, or go back to the findings.`}
      action={<Button asChild size="sm"><Link to="/">Go to the findings</Link></Button>} />
  )
}
