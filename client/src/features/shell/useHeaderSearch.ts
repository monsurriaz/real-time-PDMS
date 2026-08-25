import { createContext, useContext, useEffect } from 'react'

/**
 * The header search box's wiring — v3.1 addendum: a real client-side filter
 * over rows a screen has already fetched, not a new endpoint, and a
 * placeholder that names what it searches on THAT screen rather than
 * implying a global search that doesn't exist.
 *
 * AppShell owns the query text and renders the one `<input>`; a screen with
 * a searchable table calls `useSearchable(placeholder)` to both claim the box
 * (setting its placeholder) and read what's been typed into it. A screen
 * that never calls it leaves the box in its neutral, disabled state — see
 * AppShell's own header markup — rather than sitting there enabled and
 * silently doing nothing, which is worse than admitting there's nothing to
 * search here.
 *
 * Context, not a prop AppShell forwards to `children`: `children` is already
 * whatever the page rendered before AppShell had a reason to intercept it,
 * and threading a search prop through every single page component just to
 * hand it to one nested table would be exactly the kind of coupling a
 * context exists to avoid.
 */
export interface HeaderSearchApi {
  query: string
  setPlaceholder: (placeholder: string | null) => void
}

export const HeaderSearchContext = createContext<HeaderSearchApi | null>(null)

/**
 * Claims the header's search box for as long as the calling component is
 * mounted, and returns what's currently typed into it. Since AppShell is
 * created fresh by every page (it is not a persistent layout wrapping
 * react-router's Outlet), the placeholder and query it exposes are already
 * scoped to this one screen's lifetime — there is nothing to clear on
 * unmount that the next screen's own fresh AppShell instance would not
 * already start clean with.
 */
export const useSearchable = (placeholder: string): string => {
  const ctx = useContext(HeaderSearchContext)
  useEffect(() => {
    ctx?.setPlaceholder(placeholder)
  }, [ctx, placeholder])
  return ctx?.query ?? ''
}
