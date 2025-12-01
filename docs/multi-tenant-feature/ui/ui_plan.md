Multi-Tenant UI Implementation Tasks
Overview
Implement organized UI for multi-tenant workspace features including super-admin dashboard, tenant admin settings, and invitation flows.

Backend Status: ✅ 100% Complete (API, DB, Utilities) UI Status: 🚧 0% Complete (All pages need to be built)

Phase 1: Foundation - Install Dependencies & Shared Components
Estimated: 2-3 hours ✅ COMPLETE

 Install Radix Tabs dependency
 Run npm install @radix-ui/react-tabs
 Create 
components/ui/tabs.tsx
 TabsList component
 TabsTrigger component
 TabsContent component
 Apply app theme styling
 Create 
components/ui/data-table.tsx
 Column sorting
 Pagination controls
 Search/filter support
 Row actions menu
 Loading skeleton states
 Empty state support
 Create 
components/ui/page-header.tsx
 Title and description
 Breadcrumbs support
 Action buttons slot
 Responsive layout
 Create 
components/ui/empty-state.tsx
 Icon display
 Title and description
 Primary action button
 Consistent styling
 Fixed CardFooter export in card.tsx
 Fixed TypeScript errors in invitations API route
 Verified TypeScript compilation (npx tsc --noEmit)
Phase 2: Admin Dashboard Structure
Estimated: 4-6 hours

Admin Layout
 Create 
app/admin/layout.tsx
 SUPER_ADMIN route protection
 Sidebar navigation component
 Navigation items: Tenants, Feature Flags
 Responsive sidebar (collapsible on mobile)
 Active route highlighting
 Consistent with app theme
Admin Homepage
 Create 
app/admin/page.tsx
 Redirect to 
/admin/tenants
Tenant List Page
 Create 
app/admin/tenants/page.tsx
 Fetch tenants with GET /api/admin/tenants
 Data table with columns: Name, Slug, Status, Admin, Created Date, User Count
 Search by name
 Filter by status (active, trial, suspended)
 Pagination controls
 "Create Tenant" button
 Row actions: View, Edit Status, Suspend
 Loading states
 Empty state for no tenants
Create Tenant Dialog
 Create 
components/tenants/create-tenant-dialog.tsx
 Name field with validation (min 3 chars)
 Slug field (auto-generate from name)
 Manual slug override
 Real-time validation feedback
 API call to POST /api/admin/tenants
 Success toast notification
 Error handling
 Reset form on close
Phase 3: Admin Tenant Detail Page
Estimated: 6-8 hours

Tenant Detail Structure
 Create 
app/admin/tenants/[id]/page.tsx
 Breadcrumb: Admin / Tenants / [Name]
 Fetch tenant data with GET /api/admin/tenants/[id]
 Tabbed interface using Radix Tabs
 5 tabs: Overview, Branding, Features, Users, Agents
Overview Tab
 Display tenant ID (copyable)
 Display name (inline edit)
 Display slug (inline edit)
 Display status with badge (inline edit)
 Display created by email
 Display created date
 Save changes with PUT /api/admin/tenants/[id]
Branding Tab
 Logo URL input field
 Logo image preview
 Primary color picker (use 
ColorPicker
 component)
 Secondary color picker
 Live preview using BrandingPreview component
 Save button
 API call: PUT /api/tenants/[id]/branding
 Success/error toast
Features Tab
 Fetch all feature flags with GET /api/admin/feature-flags
 Fetch tenant toggles with GET /api/tenants/[id]/config
 Display each feature with 
FeatureToggle
 component
 Show: Name, Description, Default Value, Current State
 Toggle switches
 API call on toggle: PUT /api/tenants/[id]/features
 Optimistic UI updates
 Error rollback
Users Tab
 Fetch tenant users with GET /api/tenants/[id]/users
 Data table: Email, Role (with RoleBadge), Joined Date, Actions
 "Invite User" button
 Role select dropdown (TENANT_ADMIN, MEMBER)
 Change role: PUT /api/tenants/[id]/users/[userId]/role
 Remove user button with confirmation
 Remove user: DELETE /api/tenants/[id]/users/[userId]/role
 Empty state for no members
Agents Tab
 Query agents: SELECT * FROM vibe_agents WHERE tenant_id = ?
 Display agent cards: Name, URL, Created Date
 Link to agent detail pages
 Empty state if no agents
Phase 4: Feature Flags Management
Estimated: 2-3 hours

Feature Flags Page
 Create 
app/admin/feature-flags/page.tsx
 Fetch flags with GET /api/admin/feature-flags
 Data table: Name, Description, Default Value, Tenants Using Count
 "Create Feature Flag" button
 Edit action
 Archive action (soft delete)
 Loading and empty states
Create Feature Flag Dialog
 Create 
components/tenants/create-feature-flag-dialog.tsx
 Name field (uppercase snake_case validation)
 Description field (optional)
 Default value toggle
 API call: POST /api/admin/feature-flags
 Success toast and table refresh
 Error handling
Phase 5: Tenant Settings (Tenant Admin View)
Estimated: 4-5 hours

Settings Layout
 Create 
app/settings/layout.tsx
 Route protection (TENANT_ADMIN or SUPER_ADMIN)
 Sidebar navigation
 Links: General, Tenant, Team
 Consistent styling with admin layout
Tenant Settings Page
 Create 
app/settings/tenant/page.tsx
 Fetch active tenant context
 Fetch tenant data: GET /api/tenants/[id]/config
 Tabbed interface: Branding, Features, Info
 Read-only tenant name/slug display
Branding Tab
 Same as admin branding tab
 Logo URL input and preview
 Color pickers
 Live preview
 Save: PUT /api/tenants/[id]/branding
Features Tab
 Display all feature flags (read-only)
 Show enabled/disabled state
 Show default values
 No toggle ability
 Tooltip explaining super-admin control
Info Tab
 Display tenant ID
 Display slug
 Display status
 Display created date
 Show member count
Phase 4: Feature Flags Management Page
Estimated: 2-3 hours ✅ COMPLETE

 Create 
app/admin/feature-flags/page.tsx
 List all feature flags with DataTable
 Search/filter functionality
 Create feature flag button
 Display: name, description, default value
 Create 
components/tenants/create-feature-flag-dialog.tsx
 Name input (uppercase validation)
 Description textarea
 Default value toggle
 Validation and error handling
 API integration: POST /api/admin/feature-flags
Phase 5: Tenant Settings UI (for Tenant Admins)
Estimated: 4-5 hours ✅ COMPLETE (Basic Structure)

 Create 
app/settings/layout.tsx
 Sidebar navigation
 Links: Tenant, Team
 Auth check (tenant admin or higher)
 Create 
app/settings/tenant/page.tsx
 Placeholder for tenant settings
 Ready for branding/features UI
 Create 
app/settings/tenant/team/page.tsx
 Placeholder for team management
 Ready for invite/role management
Note: Placeholder pages created. Full implementation can be enhanced later with:

Branding editor (similar to admin tenant branding tab)
Feature toggles (limited to tenant's features)
Team invite dialog
Full team member list with role management
Phase 6: Invitation Onboarding Flow
Estimated: 3-4 hours ✅ COMPLETE

 Create 
app/invite/[token]/page.tsx
 Fetch invitation by token
 Display invitation details with InvitationCard
 Check expiry status
 Unauthenticated state:
 "Sign In to Accept" button (with redirect)
 "Create Account" button (with redirect)
 Authenticated state:
 "Accept Invitation" button
 API integration: POST /api/invitations/[token]/accept
 Success toast and redirect to /agents
 Error states:
 Expired invitation
 Already accepted
 Not found
 Loading states
Phase 7: Tenant Context Integration
Estimated: 3-4 hours ⏳ PENDING

Header Update
 Modify 
components/header.tsx
 Fetch user's tenants on mount
 Get active tenant ID from context
 Add 
TenantSwitcher
 component
 Position: Between logo and user menu
 Only show if user has > 1 tenant
 Handle tenant switch
 API call: PUT /api/user/active-tenant
 Refresh page after switch
Agents Page Update
 Modify app/agents/page.tsx
 Get active tenant from context
 Filter agents by tenant_id
 Show tenant branding in header
 Empty state specific to tenant
 "Create Agent" button
Middleware Update
 Modify 
middleware.ts
 Add role check helper
 Protect /admin/* → SUPER_ADMIN only
 Protect /settings/tenant/* → TENANT_ADMIN or SUPER_ADMIN
 Allow /invite/[token] public access
 Inject active tenant ID in headers
 Redirect unauthorized users to /agents
Phase 8: Polish & Testing
Estimated: 4-6 hours

UI Polish
 Verify responsive design on mobile, tablet, desktop
 Add loading skeletons for all async operations
 Implement error boundaries for pages
 Toast notifications consistency
 Confirm dialogs for destructive actions
 Empty states for all lists
 Form validation messages
 Disabled states for buttons during loading
Accessibility
 Keyboard navigation for all dialogs
 Tab trapping in modals
 ARIA labels on all interactive elements
 Focus management (auto-focus first input in dialogs)
 Color contrast audit (WCAG AA)
 Screen reader testing (basic)
 Alt text for images
Testing Checklist
 Build succeeds: npm run build
 No TypeScript errors
 No console errors in browser
 Super-admin can create tenants
 Super-admin can manage all tenant settings
 Super-admin can toggle features
 Tenant admin can update branding
 Tenant admin can invite users
 Invitation email link works
 User can accept invitation
 User gains correct tenant access
 Multi-tenant user can switch tenants
 Agent list filters by tenant
 RLS prevents unauthorized access
 Feature flags work correctly
 Branding applies to UI
Performance
 Test with 50+ tenants (pagination works)
 Test with 20+ users per tenant
 Measure page load times (< 1s target)
 Verify no memory leaks on tenant switch
 Optimize re-renders (React DevTools)
Success Criteria
Functional Requirements
✅ Super-admin can manage all tenants ✅ Super-admin can manage feature flags ✅ Tenant admin can manage their tenant ✅ Tenant admin can invite users ✅ Users can accept invitations ✅ Multi-tenant users can switch tenants

Technical Requirements
✅ All pages build without errors ✅ Role-based route protection works ✅ API integration complete ✅ Loading and error states handled ✅ Responsive on all screen sizes ✅ Accessible (keyboard nav, ARIA)

Quality Requirements
✅ No TypeScript errors ✅ No console warnings ✅ Consistent styling with app theme ✅ User-friendly error messages ✅ Performance targets met

Notes
Existing Components: Reuse TenantCard, 
TenantSwitcher
, RoleBadge, 
FeatureToggle
, 
ColorPicker
, BrandingPreview, 
InvitationCard
, FeatureGate
API Routes: All backend routes are complete and tested
Database: Ensure migration is applied before starting
Super Admin: Assign at least one user as SUPER_ADMIN in DB before testing
Email Templates: Configure in Supabase after UI is complete
Dependencies
To Install:

npm install @radix-ui/react-tabs
Already Installed:

@radix-ui/react-dialog
@radix-ui/react-dropdown-menu
@radix-ui/react-select
@radix-ui/react-switch
@radix-ui/react-separator
lucide-react
react-hot-toast
