<!-- b8c2af6f-61b8-42d5-af50-aa675d251569 36394300-da78-4703-928b-8b5cf27e412d -->
# Landing Page Design Implementation

## Overview

Create a modern landing page for the VibesBoard application at `/app/landing/page.tsx` that showcases the platform's ability to build agents for vibing with people. The design will be inspired by the NORRE reference website with a clean, minimalist aesthetic.

## Key Changes

### 1. Font Setup (Switzer)

- Add Switzer font configuration in `lib/fonts.ts`
- Set up font files structure in `assets/fonts/` (ready for font files)
- Update `app/layout.tsx` to include Switzer font variable
- Note: Font files not present - structure will be ready when files are added

### 2. Color Palette Integration

- Update `tailwind.config.js` with custom color palette:
- `black-primary`: #050505
- `gray-secondary`: #969696
- `black-bg`: #FFFEFA
- `purewhite-bg`: #FFFFFF
- `black-10%`: #050505 (10% opacity)
- `black-25%`: #050505 (25% opacity)
- `black-50%`: #000000 (50% opacity)
- Update `app/globals.css` with CSS variables for the new colors

### 3. Typography System

- Configure typography scale matching reference design:
- H1: 100px / 1.1 line-height
- H2: 140px / 1.1 line-height (or scaled appropriately)
- H3: 51px / 1.3 line-height
- H5: 18px / 2.1 line-height
- Body Small: 17px / 1.3
- Body Medium: 21px / 1.5
- Body Large: 24px / 1.6
- Add typography utilities to Tailwind config

### 4. Landing Page Route

- Create `/app/landing/page.tsx` with main landing page component
- Update `middleware.ts` to allow `/landing` route without authentication
- Create landing-specific header component (simplified, no sidebar)

### 5. Landing Page Components

Create components in `components/landing/`:

- `landing-hero.tsx` - Hero section with main headline "Build Agents to Vibe with People"
- `landing-features.tsx` - Three key features: Build Agents, Record Vibes, AI Insights
- `landing-statistics.tsx` - Statistics/metrics section (carousel-style)
- `landing-cta.tsx` - Call-to-action section
- `landing-footer.tsx` - Footer with navigation links
- `landing-header.tsx` - Simplified header for landing page

### 6. Responsive Design

- Implement responsive breakpoints for desktop, tablet, and mobile
- Use Tailwind responsive utilities (sm, md, lg, xl)
- Ensure proper grid layouts that adapt across screen sizes
- Match NORRE reference responsive behavior

### 7. Design Elements

- Clean, minimalist design with ample white space
- Professional typography hierarchy
- Subtle animations/transitions (optional)
- Modern button styles matching the color palette
- Card components for feature sections

## Files to Create/Modify

**New Files:**

- `app/landing/page.tsx`
- `components/landing/landing-hero.tsx`
- `components/landing/landing-features.tsx`
- `components/landing/landing-statistics.tsx`
- `components/landing/landing-cta.tsx`
- `components/landing/landing-footer.tsx`
- `components/landing/landing-header.tsx`

**Modified Files:**

- `lib/fonts.ts` - Add Switzer font configuration
- `tailwind.config.js` - Add color palette and typography scale
- `app/globals.css` - Add CSS variables for colors
- `middleware.ts` - Allow `/landing` route without auth
- `app/layout.tsx` - Conditionally render different headers (or create layout wrapper)

## Implementation Notes

- Switzer font files need to be added to `assets/fonts/` directory when available
- Use Next.js Image component for any images/illustrations
- Ensure all text content aligns with the platform description
- Maintain accessibility standards (semantic HTML, ARIA labels)
- Use TypeScript for type safety

### To-dos

- [ ] Set up Switzer font configuration in lib/fonts.ts and prepare font file structure
- [ ] Add custom color palette to tailwind.config.js and globals.css
- [ ] Configure typography scale in Tailwind config matching reference design
- [ ] Update middleware.ts to allow /landing route without authentication
- [ ] Create landing-header.tsx component with simplified navigation
- [ ] Create landing-hero.tsx with main headline and CTA button
- [ ] Create landing-features.tsx showcasing three key features (Build, Record, Insights)
- [ ] Create landing-statistics.tsx with statistics/metrics carousel section
- [ ] Create landing-cta.tsx with call-to-action section
- [ ] Create landing-footer.tsx with navigation links and contact info
- [ ] Create app/landing/page.tsx that composes all landing components
- [ ] Ensure all components are fully responsive (desktop, tablet, mobile)