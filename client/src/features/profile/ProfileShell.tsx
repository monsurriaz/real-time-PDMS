import { useState, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import { Avatar } from '@/components/Table'

/**
 * v3's Profile section: "one layout, three variants. Tabs rather than a
 * second sidebar, since the rail is already the navigation."
 *
 * The identity block (avatar, name, role line, an approval badge for a
 * rider) sits ABOVE the tabs and stays fixed while they switch — the
 * reference screenshot only shows the Account tab, where that block and the
 * account fields share one card, but repeating avatar/name/badge inside
 * every tab's own card would be the wrong read of a single screenshot. One
 * identity, three swappable bodies underneath it.
 */

export interface ProfileTab {
  key: string
  label: string
  content: ReactNode
}

interface Props {
  name: string
  roleLine: string
  badge?: ReactNode
  tabs: ProfileTab[]
}

export const ProfileShell = ({ name, roleLine, badge, tabs }: Props) => {
  const [active, setActive] = useState(tabs[0]?.key ?? '')
  const current = tabs.find((t) => t.key === active) ?? tabs[0]

  return (
    <div className="max-w-[660px]">
      <div className="flex items-center gap-15px bg-surface border border-border rounded-t-lg px-22px py-5">
        <Avatar size="lg" />
        <div className="min-w-0">
          <div className="text-lg font-semibold tracking-[-0.025em] truncate">{name}</div>
          <div className="text-sm text-muted truncate">{roleLine}</div>
          {badge ? <div className="mt-6px">{badge}</div> : null}
        </div>
        <Button
          size="sm"
          className="ml-auto flex-none"
          disabled
          title="Photo uploads aren't part of this build"
        >
          Change photo
        </Button>
      </div>

      <nav className="flex bg-surface border-x border-border px-22px" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active}
            onClick={() => setActive(t.key)}
            className={[
              'px-1 mr-6 py-11px text-body font-medium border-b-2 -mb-px cursor-pointer',
              t.key === active
                ? 'border-ink text-ink'
                : 'border-transparent text-muted hover:text-ink',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="bg-surface border border-border rounded-b-lg px-22px py-5">
        {current?.content}
      </div>
    </div>
  )
}

/** The `.blockh` label above each tab's fields — "Account", "Password", etc. */
export const ProfileBlockHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="text-base font-semibold tracking-[-0.015em] mb-4">{children}</h3>
)
