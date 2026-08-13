/**
 * Typed manifest for the brand media used on the marketing landing page.
 *
 * Every asset ships in two art directions — a wide desktop cut and a tall
 * mobile cut — so the component layer never crops a 16:9 frame into a phone
 * viewport. Source GIFs were transcoded to H.264 (a 3.5 MB GIF becomes ~280 KB
 * of MP4), and every clip carries a poster frame so the page paints something
 * before a byte of video is fetched and has something to show when the visitor
 * prefers reduced motion.
 */

export type LandingMediaType = 'video' | 'image'

export interface LandingMediaSource {
  /** Public path to the asset. */
  src: string
  /** Public path to the still frame. Videos always have one. */
  poster?: string
  width: number
  height: number
}

export interface LandingMediaAsset {
  id: string
  type: LandingMediaType
  /** Describes what happens in the frame, not just what is pictured. */
  alt: string
  desktop: LandingMediaSource
  mobile: LandingMediaSource
}

const MEDIA = '/media/landing'

export const LANDING_MEDIA_AGENT_CREATOR: LandingMediaAsset = {
  id: 'agent-creator',
  type: 'video',
  alt: 'The Vibesboard agent creator: one typed sentence streams a reply while the live form fills itself in — name, instructions, greeting and tools — ending on the agent-created success card.',
  desktop: {
    src: `${MEDIA}/vibesboard-d-05.mp4`,
    poster: `${MEDIA}/vibesboard-d-05.webp`,
    width: 1600,
    height: 900
  },
  mobile: {
    src: `${MEDIA}/vibesboard-m-05.mp4`,
    poster: `${MEDIA}/vibesboard-m-05.webp`,
    width: 1080,
    height: 1920
  }
}

export const LANDING_MEDIA_INBOX_HANDOFF: LandingMediaAsset = {
  id: 'inbox-handoff',
  type: 'video',
  alt: 'The unified WhatsApp inbox: the booking agent auto-replies in an open thread with delivery ticks, then a human taps Pause Agent to take the conversation over.',
  desktop: {
    src: `${MEDIA}/vibesboard-d-04.mp4`,
    poster: `${MEDIA}/vibesboard-d-04.webp`,
    width: 800,
    height: 800
  },
  mobile: {
    src: `${MEDIA}/vibesboard-m-04.mp4`,
    poster: `${MEDIA}/vibesboard-m-04.webp`,
    width: 540,
    height: 1080
  }
}

export const LANDING_MEDIA_SHARE_DASHBOARD: LandingMediaAsset = {
  id: 'share-dashboard',
  type: 'image',
  alt: 'The agent dashboard Share tab, showing the public share link and QR code for a booking agent alongside the Setup, Knowledge, Notifications, Reviews and Integrations tabs.',
  desktop: {
    src: `${MEDIA}/vibesboard-d-06.webp`,
    width: 1600,
    height: 1200
  },
  mobile: {
    src: `${MEDIA}/vibesboard-m-06.webp`,
    width: 1080,
    height: 1440
  }
}

export const LANDING_MEDIA_CLOSING_WORDMARK: LandingMediaAsset = {
  id: 'closing-wordmark',
  type: 'video',
  alt: 'The Vibesboard wordmark breathing on a dark aurora ground under the line "Let your agent talk".',
  desktop: {
    src: `${MEDIA}/vibesboard-d-07.mp4`,
    poster: `${MEDIA}/vibesboard-d-07.webp`,
    width: 1600,
    height: 1000
  },
  mobile: {
    src: `${MEDIA}/vibesboard-m-07.mp4`,
    poster: `${MEDIA}/vibesboard-m-07.webp`,
    width: 1080,
    height: 1920
  }
}

export const LANDING_MEDIA: LandingMediaAsset[] = [
  LANDING_MEDIA_AGENT_CREATOR,
  LANDING_MEDIA_INBOX_HANDOFF,
  LANDING_MEDIA_SHARE_DASHBOARD,
  LANDING_MEDIA_CLOSING_WORDMARK
]
