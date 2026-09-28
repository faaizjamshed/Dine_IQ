import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, BarChart3, ShieldCheck, Sparkles } from 'lucide-react'
import { DineIQMark } from './DineIQMark'
import { SampleDataBadge } from '@/components/layout/SampleDataBadge'
import { USE_MOCKS } from '@/api/client'

/** The visual half of the login screen: a restrained 3D analytics scene. */
export function BrandPanel() {
  const reduced = useReducedMotion()

  return (
    <section className="relative hidden min-h-full w-[58%] overflow-hidden border-r border-white/10 bg-[#090d1b] lg:flex lg:flex-col">
      <div
        aria-hidden
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(600px 420px at 18% 14%, rgba(245,158,11,.18), transparent 68%), radial-gradient(520px 420px at 88% 84%, rgba(56,189,248,.12), transparent 68%), linear-gradient(135deg, rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(45deg, rgba(255,255,255,.018) 1px, transparent 1px)',
          backgroundSize: 'auto, auto, 44px 44px, 44px 44px',
        }}
      />

      <div aria-hidden className="pointer-events-none absolute -left-24 top-1/2 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-sky-400/10 blur-3xl" />

      <div className="relative z-10 flex h-full flex-col justify-between px-10 py-9 xl:px-14 xl:py-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DineIQMark size={42} />
            <div>
              <p className="text-lg font-extrabold tracking-tight text-foreground">DineIQ</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-subtle">Restaurant intelligence</p>
            </div>
          </div>
          {USE_MOCKS && <SampleDataBadge />}
        </header>

        <div className="grid flex-1 content-center gap-5 py-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(280px,1.1fr)] xl:items-center xl:gap-2">
          <div className="max-w-[440px]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Evidence-led decisions
            </div>
            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-[-0.04em] text-foreground xl:text-5xl">
              See the signal
              <span className="block gradient-text">behind every plate.</span>
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-muted">
              One calm workspace for menu economics, customer behaviour, demand forecasts and outlet performance — all tied back to the evidence.
            </p>

            <div className="mt-7 grid max-w-md grid-cols-3 gap-2">
              {[
                ['200', 'menu items'],
                ['25', 'outlets'],
                ['PKR', 'native currency'],
              ].map(([value, label]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3 backdrop-blur-sm">
                  <p className="font-mono text-base font-bold text-foreground">{value}</p>
                  <p className="mt-1 text-[10px] text-subtle">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative mx-auto h-[320px] w-full max-w-[390px] xl:h-[410px]" aria-hidden>
            <motion.div
              className="absolute left-1/2 top-1/2 h-[250px] w-[250px] rounded-full border border-primary/25"
              style={{ transform: 'translate(-50%, -50%) rotateX(66deg) rotateZ(-18deg)' }}
              animate={reduced ? undefined : { rotateZ: [-18, -8, -18] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
            />
            <div
              className="absolute left-1/2 top-1/2 h-[300px] w-[150px] rounded-full border border-sky-300/20"
              style={{ transform: 'translate(-50%, -50%) rotateY(68deg) rotateZ(28deg)' }}
            />
            <div className="absolute left-1/2 top-1/2 h-[210px] w-[210px] rounded-full border border-white/10" style={{ transform: 'translate(-50%, -50%) rotateX(64deg) rotateZ(45deg)' }} />

            <motion.div
              className="absolute left-1/2 top-1/2 h-[170px] w-[170px]"
              style={{ transform: 'translate(-50%, -50%) rotateX(58deg) rotateZ(45deg)', transformStyle: 'preserve-3d' }}
              animate={reduced ? undefined : { y: [-5, 5, -5], rotateZ: [45, 49, 45] }}
              transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div className="absolute inset-0 rounded-[22px] border border-primary/60 bg-gradient-to-br from-primary/35 via-orange-400/10 to-transparent shadow-[0_0_70px_rgba(245,158,11,.28)]" style={{ transform: 'translateZ(38px)' }} />
              <div className="absolute inset-0 rounded-[22px] border border-sky-300/40 bg-gradient-to-br from-sky-300/20 to-transparent" style={{ transform: 'translateZ(-38px)' }} />
              <div className="absolute inset-0 rounded-[22px] border border-primary/35 bg-primary/10" style={{ transform: 'rotateX(90deg) translateZ(85px)' }} />
              <div className="absolute inset-0 rounded-[22px] border border-orange-300/35 bg-orange-400/10" style={{ transform: 'rotateY(90deg) translateZ(85px)' }} />
              <div className="absolute inset-[22px] rounded-xl border border-white/30 bg-[#10182b]/80 shadow-inner" style={{ transform: 'translateZ(42px)' }}>
                <div className="flex h-full flex-col justify-between p-4" style={{ transform: 'rotateZ(-45deg)' }}>
                  <div className="flex items-center justify-between">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <span className="font-mono text-[9px] text-positive">+18.4%</span>
                  </div>
                  <div>
                    <div className="mb-2 h-1.5 w-20 rounded-full bg-white/15"><div className="h-full w-14 rounded-full bg-primary" /></div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-subtle">signal strength</p>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              className="absolute left-2 top-12 rounded-2xl border border-white/10 bg-[#11182b]/80 px-3 py-2.5 shadow-xl backdrop-blur-md"
              animate={reduced ? undefined : { y: [0, -8, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-subtle">menu health</p>
              <p className="mt-1 text-sm font-bold text-foreground">Profit drivers <span className="text-positive">●</span></p>
            </motion.div>
            <motion.div
              className="absolute bottom-12 right-0 rounded-2xl border border-white/10 bg-[#11182b]/80 px-3 py-2.5 shadow-xl backdrop-blur-md"
              animate={reduced ? undefined : { y: [0, 8, 0] }}
              transition={{ duration: 5.2, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            >
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><p className="font-mono text-[9px] uppercase tracking-[0.14em] text-subtle">verified evidence</p></div>
              <p className="mt-1 text-xs font-semibold text-foreground">Every insight has a source</p>
            </motion.div>
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 pt-4">
          <p className="font-mono text-[10px] text-subtle">DineIQ Analytics · v4 intelligence layer</p>
          <p className="flex items-center gap-1 font-mono text-[10px] text-subtle">Explore the signal <ArrowUpRight className="h-3 w-3" aria-hidden /></p>
        </footer>
      </div>
    </section>
  )
}
