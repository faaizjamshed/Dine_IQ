import * as React from 'react'
import { Bot, ExternalLink, Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiPost } from '@/api/client'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AssistantSource {
  label: string
  reference: string
}

interface AssistantResponse {
  answer: string
  topic: string
  confidence: 'high' | 'medium' | 'low'
  grounded: true
  sources: AssistantSource[]
  suggestions: string[]
  navigation: string | null
}

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  response?: AssistantResponse
  failed?: boolean
}

const STARTERS = [
  'Profit formula kya hai?',
  'Top selling items dikhao',
  'Wastage risk samjhao',
  'DineIQ kya karta hai?',
]

const WELCOME: ChatMessage = {
  id: 0,
  role: 'assistant',
  text: 'Assalam-o-alaikum! Main DineIQ Guide hoon. Aap simple Urdu ya English mein formulas, dishes, outlets, forecasting, wastage aur project ke baare mein pooch sakte hain.',
}

/**
 * Persistent project guide. Answers come from the authenticated Flask API,
 * which grounds entity questions in loaded analytics and reviewed definitions.
 */
export function DineIQAssistant() {
  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([WELCOME])
  const [input, setInput] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const nextId = React.useRef(1)
  const endRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!open) return
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, open, sending])

  React.useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 80)
  }, [open])

  async function ask(prefilled?: string) {
    const question = (prefilled ?? input).trim()
    if (!question || sending) return
    setInput('')
    const userMessage: ChatMessage = { id: nextId.current++, role: 'user', text: question }
    setMessages((current) => [...current, userMessage])
    setSending(true)
    try {
      const response = await apiPost<AssistantResponse>('/api/assistant/chat', { message: question })
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: 'assistant', text: response.answer, response },
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The guide could not answer this question.'
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: 'assistant', text: `${message} Please try again.`, failed: true },
      ])
    } finally {
      setSending(false)
    }
  }

  function goTo(path: string) {
    navigate(path)
    setOpen(false)
  }

  return (
    <>
      {open && (
        <section
          aria-label="DineIQ Guide chat"
          className="fixed inset-x-3 bottom-3 z-[70] flex max-h-[min(720px,calc(100vh-24px))] flex-col overflow-hidden rounded-2xl border border-border-strong bg-background-subtle shadow-panel sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(680px,calc(100vh-40px))] sm:w-[430px]"
        >
          <header className="flex items-center gap-3 border-b border-border bg-gradient-to-r from-primary/15 to-primary-strong/5 px-4 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-strong text-primary-foreground shadow-glow">
              <Bot className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold text-foreground">DineIQ Guide</h2>
              <p className="flex items-center gap-1 text-[10px] text-muted">
                <Sparkles className="h-3 w-3 text-primary" aria-hidden />
                Project evidence + loaded analytics
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)} aria-label="Close DineIQ Guide">
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-4" aria-live="polite">
            <div className="space-y-4">
              {messages.map((message) => (
                <article key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[88%]', message.role === 'user' ? 'text-right' : 'text-left')}>
                    <div
                      className={cn(
                        'whitespace-pre-wrap rounded-2xl px-3.5 py-3 text-left text-xs leading-relaxed',
                        message.role === 'user'
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : message.failed
                            ? 'rounded-bl-md border border-critical/30 bg-critical/10 text-foreground'
                            : 'rounded-bl-md border border-border bg-surface text-foreground',
                      )}
                    >
                      {message.text}
                    </div>

                    {message.response && (
                      <div className="mt-2 space-y-2 px-1 text-left">
                        {message.response.sources.length > 0 && (
                          <details className="text-[10px] text-muted">
                            <summary className="cursor-pointer select-none font-semibold text-muted">
                              Sources · {message.response.confidence} confidence
                            </summary>
                            <ul className="mt-1 space-y-1 border-l border-border pl-2">
                              {message.response.sources.map((source) => (
                                <li key={`${source.label}-${source.reference}`}>
                                  <span className="font-semibold text-foreground">{source.label}</span>
                                  <span className="block break-all font-mono text-[9px] text-subtle">{source.reference}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {message.response.navigation && (
                          <button
                            type="button"
                            onClick={() => goTo(message.response!.navigation!)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/10"
                          >
                            Open relevant dashboard <ExternalLink className="h-3 w-3" aria-hidden />
                          </button>
                        )}
                        {message === messages[messages.length - 1] && message.response.suggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {message.response.suggestions.slice(0, 3).map((suggestion) => (
                              <button
                                type="button"
                                key={suggestion}
                                onClick={() => void ask(suggestion)}
                                disabled={sending}
                                className="rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] text-muted transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}

              {messages.length === 1 && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {STARTERS.map((starter) => (
                    <button
                      type="button"
                      key={starter}
                      onClick={() => void ask(starter)}
                      className="rounded-xl border border-border bg-surface p-2.5 text-left text-[10px] font-semibold leading-relaxed text-muted transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              )}

              {sending && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-surface px-3 py-2 text-xs text-muted">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                    Checking project evidence…
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <form
            className="border-t border-border bg-background/80 p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void ask()
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-2 focus-within:border-primary/60">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, 800))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void ask()
                  }
                }}
                rows={2}
                maxLength={800}
                placeholder="Ask about a dish, formula or dashboard…"
                aria-label="Question for DineIQ Guide"
                className="min-h-10 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-foreground outline-none placeholder:text-subtle"
              />
              <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!input.trim() || sending} aria-label="Send question">
                <Send className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[9px] text-subtle">Grounded in stored evidence · Verify business decisions with an analyst</p>
          </form>
        </section>
      )}

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-[65] flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary-strong px-4 py-3 text-xs font-extrabold text-primary-foreground shadow-glow transition-transform hover:scale-[1.03] sm:bottom-5 sm:right-5"
          aria-label="Open DineIQ Guide"
        >
          <MessageCircle className="h-5 w-5" aria-hidden />
          <span>Ask DineIQ</span>
        </button>
      )}
    </>
  )
}
