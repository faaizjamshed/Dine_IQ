import { AlertTriangle, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatInt } from '@/lib/formatters'
import type { ReportRunResponse } from '@/api/types'

type ReportRunData = ReportRunResponse['data']

/**
 * serializeCsv — converts the API-returned columns+rows into RFC-style CSV.
 *
 * Data integrity: this serializer is strictly presentational — it renders
 * exactly the cells the backend returned, in the backend's order, and never
 * invents, renames or reorders values. Escaping: fields containing a comma,
 * double quote or line break are wrapped in double quotes with embedded
 * quotes doubled; rows join with \r\n; a UTF-8 BOM is prepended so Excel
 * opens the file with correct encoding.
 */
function serializeCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, string | number>[],
): string {
  const escape = (raw: string | number): string => {
    const s = String(raw)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = columns.map((c) => escape(c.label)).join(',')
  const body = rows.map((row) => columns.map((c) => escape(row[c.key] ?? '')).join(','))
  return `\uFEFF${[header, ...body].join('\r\n')}`
}

/**
 * ExportResultCard — the post-run panel for POST /api/reports/{id}/run:
 * report name, generatedAt, row count, an amber "truncated sample" warning
 * when the API flags `truncated`, a Download CSV button built ONLY from the
 * API-returned columns+rows (zero invented rows), and a preview table of the
 * first 8 returned rows.
 */
export function ExportResultCard({
  result,
  reportName,
  dateFrom,
  dateTo,
  onDismiss,
}: {
  result: ReportRunData
  /** Display name resolved from the catalog by reportId (falls back to the id). */
  reportName?: string
  dateFrom?: string
  dateTo?: string
  onDismiss: () => void
}) {
  const download = () => {
    const csv = serializeCsv(result.columns, result.rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${result.reportId}-${dateFrom || 'all'}-${dateTo || 'all'}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="Export result" className="glass-card relative flex flex-col gap-3 p-5">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss export result"
        className="absolute right-3 top-3 rounded-md p-1 text-subtle transition-colors hover:bg-surface-strong hover:text-foreground"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      <div className="pr-8">
        <span className="overline-label text-primary">Export ready</span>
        <h3 className="mt-0.5 text-sm font-bold tracking-tight text-foreground">
          {reportName ?? result.reportId}
        </h3>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-subtle">
        <span>Generated {formatDateTime(result.generatedAt)}</span>
        <span aria-hidden>·</span>
        <span>{formatInt(result.rowCount)} rows</span>
      </div>

      {result.truncated && (
        <p
          role="status"
          className="flex items-start gap-1.5 rounded-lg border border-medium/40 bg-medium/10 px-2.5 py-2 text-[11px] font-medium leading-snug text-medium"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Partial report — the existing report route returns at most 1000 records.
        </p>
      )}

      <div>
        <Button size="sm" onClick={download} disabled={result.rows.length === 0}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download CSV
        </Button>
      </div>

      {result.rows.length === 0 ? (
        <p className="text-xs text-subtle">The API returned no rows for this report in the current scope.</p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-lg border border-border dineiq-scrollbar">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Preview of the first 8 rows returned by the export — full file available via Download CSV
            </caption>
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wide text-subtle">
                {result.columns.map((c) => (
                  <th key={c.key} scope="col" className="whitespace-nowrap py-2 pl-2 pr-2 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.slice(0, 8).map((row, i) => (
                <tr key={i} className="border-t border-border/60 text-xs">
                  {result.columns.map((c) => {
                    const value = row[c.key]
                    return (
                      <td
                        key={c.key}
                        className={
                          typeof value === 'number'
                            ? 'data-value whitespace-nowrap py-1.5 pl-2 pr-2 text-[11px] text-foreground'
                            : 'whitespace-nowrap py-1.5 pl-2 pr-2 text-muted'
                        }
                      >
                        {value}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
