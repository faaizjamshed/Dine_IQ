import * as React from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { DishThumb } from '@/components/ui/dish-thumb'
import { ChartCard, ChartErrorFrom, ChartEmpty, ChartSkeleton } from '@/components/charts'
import { getChartTheme, performanceClassColor } from '@/lib/chartTheme'
import { useTheme } from '@/components/layout/theme'
import { formatPKR, formatPct, formatNumberCompact } from '@/lib/formatters'
import type { TopBottomDishes, DishRankItem, PerformanceClass } from '@/api/types'

const CLASS_LABEL: Record<PerformanceClass, string> = {
  unclassified: 'Unclassified',
  profit_driver: 'Profit Driver',
  volume_driver: 'Volume Driver',
  hidden_opportunity: 'Hidden Opportunity',
  low_performer: 'Low Performer',
}

/**
 * TopBottomDishesCard — ranked dish performance (spec §24, "Do not invent
 * rankings"). Ranks come straight from kpis.topBottomDishes; bar color
 * encodes the API's performance class using the business palette (§08).
 */
export function TopBottomDishesCard({
  dishes,
  loading,
  error,
  onRetry,
  className,
}: {
  dishes?: TopBottomDishes
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  const { isLight } = useTheme()
  const theme = getChartTheme(isLight)

  if (error) {
    return (
      <ChartCard title="Dish Rankings" subtitle="Revenue leaders and laggards" className={className}>
        <ChartErrorFrom error={error} onRetry={onRetry} fallbackMessage="Unable to load dish rankings." />
      </ChartCard>
    )
  }

  if (loading || !dishes) {
    return (
      <ChartCard title="Dish Rankings" subtitle="Revenue leaders and laggards" className={className}>
        <ChartSkeleton height={300} />
      </ChartCard>
    )
  }

  const hasData = dishes.top.length > 0 || dishes.bottom.length > 0

  return (
    <ChartCard
      title="Dish Rankings"
      subtitle="Revenue leaders and laggards with performance class"
      className={className}
    >
      {!hasData ? (
        <ChartEmpty message="No dish rankings for the selected filters." />
      ) : (
        <Tabs defaultValue="top">
          <TabsList className="w-full">
            <TabsTrigger value="top" className="flex-1">
              Top {dishes.top.length}
            </TabsTrigger>
            <TabsTrigger value="bottom" className="flex-1">
              Bottom {dishes.bottom.length}
            </TabsTrigger>
          </TabsList>

          {(['top', 'bottom'] as const).map((tab) => {
            const items = dishes[tab]
            const height = Math.max(items.length * 30 + 30, 120)
            return (
              <TabsContent key={tab} value={tab} className="mt-3">
                <div style={{ height }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={items}
                      layout="vertical"
                      margin={{ top: 0, right: 46, bottom: 0, left: 0 }}
                    >
                      <XAxis
                        type="number"
                        tickFormatter={(v: number) => formatPKR(v, { compact: true }).replace('PKR ', '')}
                        tick={{ fill: theme.textMuted, fontSize: 9 }}
                        axisLine={false}
                        tickLine={false}
                        hide
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={104}
                        tick={{ fill: theme.text, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: theme.gridLine }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload as DishRankItem
                          return (
                            <div
                              className="flex items-start gap-2.5 rounded-lg border p-2.5 text-xs shadow-panel"
                              style={{
                                background: theme.tooltipBg,
                                borderColor: theme.tooltipBorder,
                                color: theme.tooltipText,
                              }}
                            >
                              <DishThumb itemId={d.itemId} name={d.name} size="md" />
                              <div>
                                <p className="font-semibold">
                                  #{d.rank} {d.name}
                                </p>
                                <p className="mt-1 font-mono">{formatPKR(d.revenue)}</p>
                                <p className="font-mono text-muted">
                                  {formatNumberCompact(d.quantity)} sold · margin {formatPct(d.marginPct)}
                                </p>
                                <p className="mt-1 text-[10px] uppercase tracking-wide text-subtle">
                                  {CLASS_LABEL[d.performanceClass]}
                                </p>
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]} barSize={16}>
                        {items.map((d) => (
                          <Cell
                            key={d.itemId}
                            fill={performanceClassColor(d.performanceClass, theme)}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-subtle">
                  Bar color = API performance class: {Object.values(CLASS_LABEL).join(' · ')}
                </p>
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </ChartCard>
  )
}
