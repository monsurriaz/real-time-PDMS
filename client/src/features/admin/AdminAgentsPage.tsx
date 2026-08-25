import { useMemo, useState } from 'react'
import type { AgentRosterItem } from '@pdms/shared'
import { AppShell, PageHead } from '@/components/AppShell'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Badge'
import { TableScroll, Td, Thead, Tr, Who } from '@/components/Table'
import { useSearchable } from '@/features/shell/useHeaderSearch'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useAgentRoster, useApproveAgent, useRejectAgent } from './useAgentRoster'

/**
 * /admin/agents — v3's "Riders + approval queue". Pending applications get
 * their own table above the roster (v3's own screenshot label), not mixed
 * into it: an admin scanning the roster for who is on shift should not also
 * be scanning past rows nobody has decided on yet.
 */

const VEHICLE_LABEL: Record<string, string> = {
  motorcycle: 'Motorcycle',
  bicycle: 'Bicycle',
  van: 'Van',
}

const SHIFT_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On a delivery',
  offline: 'Off shift',
}

const DecisionButtons = ({ agent }: { agent: AgentRosterItem }) => {
  const approve = useApproveAgent()
  const reject = useRejectAgent()
  const busy = approve.isPending || reject.isPending
  const err = (approve.error ?? reject.error) instanceof ApiError
    ? ((approve.error ?? reject.error) as ApiError).message
    : null

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        {/*
          Neither is the accent — approving a rider doesn't move a parcel
          forward, per v3's own reasoning for keeping that colour to a
          lifecycle state. Matches the reference exactly: Reject is the
          quiet default, Approve is ink.
        */}
        <Button size="sm" disabled={busy} onClick={() => reject.mutate(agent._id)}>
          {reject.isPending ? 'Rejecting…' : 'Reject'}
        </Button>
        <Button size="sm" variant="ink" disabled={busy} onClick={() => approve.mutate(agent._id)}>
          {approve.isPending ? 'Approving…' : 'Approve'}
        </Button>
      </span>
      {err ? <span className="text-eyebrow text-failed-ink">{err}</span> : null}
    </div>
  )
}

/**
 * The actual roster tables — a component of its own, rendered AS A CHILD of
 * `<AppShell>` rather than inline in the page that calls AppShell, so that
 * `useSearchable` runs where React actually provides the header's search
 * context: inside AppShell's rendered tree, not in the parent component that
 * constructs `<AppShell>` as an element. Calling it directly in
 * AdminAgentsPage's own body would see no provider yet and the box would
 * stay unclaimed — a silent bug, not a crash, which is exactly why this is a
 * separate component rather than a shortcut.
 */
const RidersContent = () => {
  const roster = useAgentRoster()
  const [rejectedOpen, setRejectedOpen] = useState(false)
  const search = useSearchable('Search rider name, phone or zone…')

  const { pending, approved, rejected } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (roster.data ?? []).filter(
      (a) =>
        q === '' ||
        a.name.toLowerCase().includes(q) ||
        a.phone.toLowerCase().includes(q) ||
        a.zones.some((z) => z.toLowerCase().includes(q)),
    )
    return {
      pending: rows.filter((a) => a.approvalStatus === 'pending'),
      approved: rows.filter((a) => a.approvalStatus === 'approved'),
      rejected: rows.filter((a) => a.approvalStatus === 'rejected'),
    }
  }, [roster.data, search])

  return (
    <>
      {roster.isPending ? (
        <Card>
          <p className="text-body text-muted">Loading riders…</p>
        </Card>
      ) : roster.isError ? (
        <Card>
          <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
            {roster.error instanceof ApiError ? roster.error.message : 'Riders could not be loaded.'}
          </p>
        </Card>
      ) : (
        <div className="grid gap-5">
          <Card
            title="Pending applications"
            action={
              pending.length > 0 ? (
                <Pill tone="pending">{pending.length} waiting</Pill>
              ) : undefined
            }
            pad={false}
          >
            {pending.length === 0 ? (
              <div className="px-18px py-8 text-center">
                <p className="text-body text-muted">Nothing waiting on a decision.</p>
              </div>
            ) : (
              <TableScroll min={760}>
                <Thead cols={['Rider', 'Applied', 'Vehicle', 'Zone', 'NID', '']} />
                <tbody>
                  {pending.map((a) => (
                    <Tr key={a._id}>
                      <Td>
                        <Who name={a.name} sub={a.phone} />
                      </Td>
                      <Td>
                        <span className="mono text-small">{formatDateTime(a.appliedAt)}</span>
                      </Td>
                      <Td>{VEHICLE_LABEL[a.vehicle] ?? a.vehicle}</Td>
                      <Td>{a.zones.join(', ')}</Td>
                      <Td>
                        <span className="mono text-small">{a.maskedNid}</span>
                      </Td>
                      <Td align="right">
                        <DecisionButtons agent={a} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </TableScroll>
            )}
          </Card>

          <Card title={`Roster · ${approved.length}`} pad={false}>
            {approved.length === 0 ? (
              <div className="px-18px py-8 text-center">
                <p className="text-body text-muted">No approved riders yet.</p>
              </div>
            ) : (
              <TableScroll min={680}>
                <Thead cols={['Rider', 'Vehicle', 'Zones', 'Shift']} />
                <tbody>
                  {approved.map((a) => (
                    <Tr key={a._id}>
                      <Td>
                        <Who name={a.name} sub={a.phone} />
                      </Td>
                      <Td>{VEHICLE_LABEL[a.vehicle] ?? a.vehicle}</Td>
                      <Td className="text-ink-2">{a.zones.join(', ')}</Td>
                      <Td>{SHIFT_LABEL[a.status] ?? a.status}</Td>
                    </Tr>
                  ))}
                </tbody>
              </TableScroll>
            )}
          </Card>

          {rejected.length > 0 ? (
            <Card
              title="Not approved"
              action={
                <button
                  type="button"
                  onClick={() => setRejectedOpen((v) => !v)}
                  className="text-small text-muted hover:text-ink"
                >
                  {rejectedOpen ? 'Hide' : `Show ${rejected.length}`}
                </button>
              }
              pad={false}
            >
              {rejectedOpen ? (
                <TableScroll min={560}>
                  <Thead cols={['Rider', 'Vehicle', 'Zone', 'Applied']} />
                  <tbody>
                    {rejected.map((a) => (
                      <Tr key={a._id}>
                        <Td>
                          <Who name={a.name} sub={a.phone} />
                        </Td>
                        <Td>{VEHICLE_LABEL[a.vehicle] ?? a.vehicle}</Td>
                        <Td className="text-ink-2">{a.zones.join(', ')}</Td>
                        <Td>
                          <span className="mono text-small text-muted">
                            {formatDateTime(a.appliedAt)}
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableScroll>
              ) : null}
            </Card>
          ) : null}
        </div>
      )}
    </>
  )
}

export const AdminAgentsPage = () => (
  <AppShell title="Riders">
    <PageHead
      title="Riders"
      sub="Applications waiting on a decision, and everyone already on the roster."
    />
    <RidersContent />
  </AppShell>
)
