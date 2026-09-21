import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// Every application route is dynamic; no shared ISR cache is needed.
export default defineCloudflareConfig()
