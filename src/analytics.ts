export type DemoAnalyticsEvent =
  | 'demo_open'
  | 'demo_path_selected'
  | 'demo_run_succeeded'
  | 'demo_review_opened'
  | 'demo_export_opened'
  | 'demo_export_downloaded'
  | 'demo_consultation_clicked'

type AnalyticsValue = string | number | boolean

export function trackDemoEvent(
  eventName: DemoAnalyticsEvent,
  parameters: Record<string, AnalyticsValue> = {},
): void {
  if (typeof window === 'undefined') return

  void fetch('/api/demos/bom-quote-review/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: eventName,
      parameters,
    }),
    keepalive: true,
  }).catch(() => undefined)
}
