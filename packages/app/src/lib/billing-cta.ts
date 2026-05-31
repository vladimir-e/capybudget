import type { ErrorBlock, SessionProvider } from "@capybudget/intelligence"

const BILLING_CTA_URLS: Partial<Record<SessionProvider, string>> = {
  anthropic: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/account/billing",
  // claude-cli — billing flows through the user's own CLI install, nothing
  // for us to link to here.
}

const BILLING_MESSAGE_PATTERN = /credit|balance|billing|quota/i

export function billingCtaUrl(block: ErrorBlock): string | null {
  if (!block.provider) return null
  const url = BILLING_CTA_URLS[block.provider]
  if (!url) return null
  const isBillingStatus = block.status === 400 || block.status === 402
  if (!isBillingStatus) return null
  if (!BILLING_MESSAGE_PATTERN.test(block.message)) return null
  return url
}
