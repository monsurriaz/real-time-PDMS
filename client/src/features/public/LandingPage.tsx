import { useMe } from '../auth/useAuth'
import { BentoGrid } from './landing/BentoGrid'
import { CtaBand } from './landing/CtaBand'
import { Faq } from './landing/Faq'
import { Footer } from './landing/Footer'
import { ForRiders } from './landing/ForRiders'
import { Hero } from './landing/Hero'
import { HowItWorks } from './landing/HowItWorks'
import { MetricsStrip } from './landing/MetricsStrip'
import { PricingSection } from './landing/PricingSection'

/**
 * `/` — v4 Meridian (M9.5), built from docs/design-v4-landing-login.html.
 *
 * v4 supersedes v3/v3.1 for the public landing page and /login ONLY — every
 * screen behind the rail, and /signup and /track/:id, keep the frozen v3 +
 * v3.1 treatment (CLAUDE.md sections 3-4). Nine sections, in the reference's
 * own order: hero, metrics strip, how it works, bento grid, pricing, for
 * riders, FAQ, CTA band, footer — replacing the page that used to end after
 * the hero and one feature band.
 *
 * A signed-in visitor still sees this exact page, not a redirect (v3's own
 * note, carried forward): only the hero's nav and the closing CTA band
 * change, to a link straight to their own dashboard.
 */
export const LandingPage = () => {
  const me = useMe()

  return (
    <div className="landing min-h-dvh bg-page">
      <Hero me={me.data} />
      <MetricsStrip />
      <HowItWorks />
      <BentoGrid />
      <PricingSection />
      <ForRiders />
      <Faq />
      <CtaBand me={me.data} />
      <Footer />
    </div>
  )
}
