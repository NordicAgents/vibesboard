# WhatsApp Bulk Messaging - Next Steps

**Last Updated:** 2024-02-15
**Status:** ✅ Coding Complete | 🚀 Ready for Deployment

---

## 📋 Overview

All coding work for WhatsApp Bulk Messaging is complete! This document outlines the steps needed to test, deploy, and launch the feature.

---

## 🎯 Phase 1: Local Testing & Setup (Week 1)

### Step 1: Install Dependencies

```bash
# Install required packages
npm install crypto-js csv-parse papaparse

# Install type definitions
npm install --save-dev @types/crypto-js
```

### Step 2: Generate Environment Variables

```bash
# Generate encryption key (for storing Meta access tokens)
openssl rand -hex 32

# Generate cron secret (to protect queue processing endpoint)
openssl rand -hex 32

# Generate webhook verify token (for Meta webhook verification)
openssl rand -hex 32
```

Add these to `.env.local`:

```bash
# New variables (add these)
ENCRYPTION_KEY=<output from first command>
CRON_SECRET=<output from second command>
WHATSAPP_VERIFY_TOKEN=<output from third command>
```

> **Note:** Data lives in Firestore. The WhatsApp collections (business accounts, templates, contacts, lists, campaigns, message queue) are auto-created on first write — no SQL migration step. Feature flags live in the `feature_flags` Firestore collection; toggle them via the admin UI rather than SQL.

### Step 5: Start Local Development Server

```bash
npm run dev
```

### Step 6: Enable Feature for Test Tenant

1. Go to `http://localhost:3000/admin/tenants`
2. Select your test tenant
3. Go to "Features" tab
4. Enable "whatsapp_bulk_messaging" toggle
5. Verify toggle appears and works

### Step 7: Test UI Pages

Visit these pages and verify they load without errors:

- `http://localhost:3000/whatsapp-bulk/business-accounts`
- `http://localhost:3000/whatsapp-bulk/templates`
- `http://localhost:3000/whatsapp-bulk/contacts`
- `http://localhost:3000/whatsapp-bulk/campaigns`

**Expected:** All pages load, show empty states with "Create" buttons

### Step 8: Verify Navigation

1. Check sidebar shows "WhatsApp Marketing" section
2. Verify all 4 links work
3. Confirm section only shows when feature is enabled
4. Test with feature disabled - section should disappear

---

## 🔐 Phase 2: Meta WhatsApp Setup (Week 1-2)

Follow the detailed guide: [`/docs/meta-whatsapp-setup-guide.md`](./meta-whatsapp-setup-guide.md)

### Quick Summary:

1. **Create Meta Business Account**
   - Go to https://business.facebook.com
   - Create or select existing business

2. **Create WhatsApp Business App**
   - Go to https://developers.facebook.com
   - Create new app → Business → WhatsApp
   - Note down App ID

3. **Set Up WhatsApp Business Account**
   - Add phone number
   - Verify phone number
   - Note down: Phone Number ID, Business Account ID

4. **Generate Access Token**
   - Go to App Dashboard → WhatsApp → API Setup
   - Generate System User Token (permanent)
   - Grant permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
   - **Save this token securely** - you'll enter it in the UI

5. **Configure Webhooks** (do this after deployment)
   - Set webhook URL: `https://your-domain.com/api/webhooks/whatsapp-bulk-status`
   - Set verify token: (the `WHATSAPP_VERIFY_TOKEN` you generated)
   - Subscribe to: `messages`, `message_status`

---

## 🧪 Phase 3: End-to-End Testing (Week 2)

### Test 1: Connect Business Account

1. Navigate to Business Accounts page
2. Click "Connect Account"
3. Enter Meta credentials:
   - Phone Number ID
   - Business Account ID
   - Access Token (from Meta)
   - Display Name (optional)
4. Click "Connect Account"

**Expected Result:**
- ✅ Account appears in list with "Active" status
- ✅ Quality rating shows (usually "GREEN")
- ✅ Messaging limit shows (e.g., "TIER_1K")

**Troubleshooting:**
- ❌ Error: "Invalid credentials" → Check Phone Number ID and Access Token
- ❌ Error: "Account not found" → Verify Business Account ID
- ❌ Error: "Permission denied" → Token needs `whatsapp_business_messaging` permission

### Test 2: Create Message Template

1. Navigate to Templates page
2. Click "Create Template"
3. Fill in:
   - Business Account: Select your connected account
   - Template Name: `hello_world` (lowercase, underscores only)
   - Category: Marketing
   - Language: English
   - Message Body: `Hello {{1}}, welcome to our service!`
4. Click "Create & Submit"

**Expected Result:**
- ✅ Template appears with "Pending" status
- ✅ Shows in Meta dashboard for review
- ⏳ Wait 15-30 minutes for Meta approval

**Common Rejection Reasons:**
- Contains promotional language without clear opt-out
- Variable placeholders are unclear
- Template name doesn't match content
- Contains links or phone numbers

**After Approval:**
- Click "Sync" button on template
- Status should change to "Approved"

### Test 3: Import Contacts

1. Navigate to Contacts page
2. Prepare CSV file with columns:
   ```csv
   phone_number,name,email
   +1234567890,John Doe,john@example.com
   +0987654321,Jane Smith,jane@example.com
   ```
3. Click "Import CSV"
4. Upload file
5. Click "Import"

**Expected Result:**
- ✅ Shows "Imported X contacts (Y skipped)"
- ✅ Contacts appear in table with "Opted In" badge
- ✅ Phone numbers normalized (stored without formatting)

**Troubleshooting:**
- ❌ Skipped contacts → Invalid phone number format (needs country code)
- ❌ Duplicates → Phone number already exists (intentionally skipped)

### Test 4: Create Contact List

1. Stay on Contacts page
2. Click "Lists" tab
3. Click "Create List"
4. Enter:
   - Name: "Test Customers"
   - Description: "Test list for campaign"
5. Click "Create List"

**Expected Result:**
- ✅ List appears with 0 contacts
- ⚠️ Note: Currently, contact-to-list assignment happens during campaign creation

### Test 5: Create & Launch Campaign

1. Navigate to Campaigns page
2. Click "Create Campaign"
3. Fill in:
   - Campaign Name: "Welcome Campaign Test"
   - Description: "Test campaign"
   - Business Account: Select your account
   - Message Template: Select approved template
   - Template Variables:
     - Variable 1: "Customer" (or leave default)
   - Contact Lists: Check "Test Customers"
4. Click "Create Campaign"

**Expected Result:**
- ✅ Campaign created with "Draft" status
- ✅ Shows in campaigns list

5. Click "Start" button (Play icon)

**Expected Result:**
- ✅ Status changes to "Sending"
- ✅ Messages appear in queue (`whatsapp_message_queue` table)
- ✅ Progress bar starts moving

### Test 6: Monitor Queue Processing

**Option A: Manually trigger cron (for testing)**
```bash
curl -X GET http://localhost:3000/api/cron/process-whatsapp-queue \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**Option B: Wait for Vercel cron** (runs every 30 seconds in production)

**Expected Result:**
- ✅ Messages sent to WhatsApp
- ✅ Campaign stats update (sent count increases)
- ✅ Recipients receive messages on WhatsApp

**Check Logs:**
```bash
# View server logs
npm run dev

# Look for:
# - "Processing message queue..."
# - "Message sent: <message_id>"
# - "Campaign stats updated"
```

### Test 7: Verify Message Delivery

1. Check your test phone number's WhatsApp
2. Verify message received with correct content
3. Variables should be replaced with actual values

**Expected Message:**
```
Hello Customer, welcome to our service!
```

### Test 8: Test Webhook (Delivery Status)

**Prerequisites:** Webhook must be configured in Meta (see Phase 2, Step 5)

1. Send test message (from Test 6)
2. Wait a few seconds
3. Check campaign stats

**Expected Result:**
- ✅ "Delivered" count increases
- ✅ Message status in queue changes to "delivered"
- ✅ `delivered_at` timestamp set

### Test 9: Test Opt-Out

1. Reply "STOP" to WhatsApp message
2. Wait for webhook processing
3. Check contact in Contacts page

**Expected Result:**
- ✅ Contact status changes to "Opted Out"
- ✅ `opted_out_at` timestamp set
- ✅ Future campaigns will skip this contact

### Test 10: Pause/Resume Campaign

1. Create campaign with 50+ contacts (to allow time for testing)
2. Start campaign
3. Wait until ~10 messages sent
4. Click "Pause" button

**Expected Result:**
- ✅ Status changes to "Paused"
- ✅ No new messages sent
- ✅ Progress bar stops

5. Click "Resume" button (Play icon)

**Expected Result:**
- ✅ Status changes to "Sending"
- ✅ Messages resume processing
- ✅ Progress bar continues

---

## 🚀 Phase 4: Production Deployment (Week 2-3)

### Step 1: Update Environment Variables in Vercel

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add production variables:
   ```bash
   ENCRYPTION_KEY=<same as local>
   CRON_SECRET=<generate new for production>
   WHATSAPP_VERIFY_TOKEN=<generate new for production>
   ```
3. Make sure existing Firebase service-account vars are set

### Step 2: Deploy to Production

```bash
# Option A: Deploy via Git
git push origin feat/whatsapp-bulk-messaging

# Option B: Deploy via Vercel CLI
vercel --prod
```

**Vercel will automatically:**
- ✅ Detect `vercel.json`
- ✅ Set up cron job (runs every 30 seconds)
- ✅ Deploy all API routes and pages

### Step 3: Add Feature Flag in Production

Add a `whatsapp_bulk_messaging` document to the `feature_flags` Firestore collection (default `false`), or toggle it via the admin UI at `/admin/tenants`.

### Step 4: Configure Meta Webhooks for Production

1. Go to Meta for Developers → Your App → WhatsApp → Configuration
2. Set Webhook URL: `https://your-production-domain.com/api/webhooks/whatsapp-bulk-status`
3. Set Verify Token: (production `WHATSAPP_VERIFY_TOKEN`)
4. Click "Verify and Save"
5. Subscribe to fields:
   - `messages`
   - `message_status`

**Test webhook:**
- Meta will send a GET request to verify
- Check Vercel logs for "Webhook verified successfully"

### Step 6: Verify Cron Job

1. Go to Vercel Dashboard → Your Project → Cron Jobs
2. Verify cron appears:
   - Path: `/api/cron/process-whatsapp-queue`
   - Schedule: `*/30 * * * * *` (every 30 seconds)
3. Check recent runs
4. View logs for any errors

### Step 7: Production Smoke Test

1. Enable feature for one test tenant
2. Connect business account (production credentials)
3. Create and approve one template
4. Add 2-3 test contacts
5. Create and launch small campaign
6. Verify messages sent and delivered

---

## 📊 Phase 5: Monitoring & Maintenance (Ongoing)

### Key Metrics to Monitor

**1. Queue Processing**
- Check Vercel cron logs daily
- Monitor for stuck messages
- Track average processing time

**2. Campaign Success Rates** — query the `whatsapp_campaigns` collection (filter by `status` and recent `createdAt`); compute delivery rate from `messagesDelivered / messagesSent`.

**3. Failed Messages** — query the `whatsapp_message_queue` collection where `status == 'failed'`, ordered by `failedAt` desc.

**4. Meta Account Health** — query the `tenant_whatsapp_business_accounts` collection; check `qualityRating`, `messagingLimit`, and `status` fields.

> Use the Firebase console or a small admin script for these — there is no SQL layer.

### Regular Maintenance Tasks

**Weekly:**
- [ ] Review failed messages
- [ ] Check account quality ratings
- [ ] Review campaign success rates
- [ ] Monitor opt-out rates

**Monthly:**
- [ ] Archive completed campaigns (optional)
- [ ] Review and optimize templates
- [ ] Check Meta billing usage
- [ ] Update documentation with learnings

### Common Issues & Solutions

**Issue: Messages not sending**
- Check cron job is running (Vercel dashboard)
- Verify `CRON_SECRET` matches in environment and requests
- Check Meta account status (not suspended)
- Verify access token hasn't expired

**Issue: High failure rate**
- Check phone number formatting (must include country code)
- Verify contacts are opted in
- Check Meta account quality rating
- Review error codes in `whatsapp_message_queue`

**Issue: Templates rejected by Meta**
- Remove promotional language
- Add clear opt-out instructions
- Ensure variables are clearly labeled
- Follow Meta's template guidelines

**Issue: Webhook not receiving updates**
- Verify webhook URL is correct
- Check `WHATSAPP_VERIFY_TOKEN` matches
- Ensure webhook is subscribed to correct fields
- Review Vercel logs for webhook errors

---

## 🎓 Phase 6: User Documentation & Training (Week 3-4)

### Create End-User Documentation

**For Tenant Admins:**
1. How to get Meta WhatsApp Business credentials
2. How to connect their account
3. How to create templates
4. How to import contacts
5. How to create and launch campaigns
6. How to read campaign analytics

**For Super Admins:**
1. How to enable feature for tenants
2. How to monitor system health
3. How to troubleshoot common issues
4. How to handle Meta policy violations

### Training Materials Needed

- [ ] Video walkthrough of setup process
- [ ] Screenshot guide for Meta setup
- [ ] Template best practices guide
- [ ] FAQ document
- [ ] Troubleshooting guide

---

## 📝 Phase 7: Beta Launch (Week 4-6)

### Step 1: Select Beta Tenants

**Criteria:**
- Active paying customers
- Good communication history
- Willing to provide feedback
- Low-risk use cases

**Suggested:** Start with 3-5 tenants

### Step 2: Beta Launch Checklist

- [ ] Enable feature for beta tenants
- [ ] Send welcome email with setup guide
- [ ] Schedule onboarding call
- [ ] Set up dedicated support channel (Slack/Discord)
- [ ] Create feedback form
- [ ] Monitor usage daily

### Step 3: Gather Feedback

**Key Questions:**
- Is the setup process clear?
- Are there any confusing UI elements?
- What features are missing?
- Are messages delivering reliably?
- What's the biggest pain point?

### Step 4: Iterate Based on Feedback

- Fix critical bugs immediately
- Plan enhancements for v2
- Update documentation based on questions
- Improve error messages

---

## 🎉 Phase 8: General Availability (Week 6+)

### Pre-Launch Checklist

- [ ] All beta feedback addressed
- [ ] Documentation complete
- [ ] Support team trained
- [ ] Pricing finalized (if applicable)
- [ ] Legal/compliance review (GDPR, TCPA, etc.)
- [ ] Monitoring dashboards set up

### Launch Plan

1. **Announce feature** (email, blog post, social media)
2. **Enable for all tenants** (or make available)
3. **Provide launch offer** (optional: free credits, discount)
4. **Host launch webinar** (optional)
5. **Monitor closely** for first 48 hours

### Success Metrics

**Week 1:**
- Number of tenants who enable feature
- Number of business accounts connected
- Number of campaigns created

**Month 1:**
- Total messages sent
- Average delivery rate
- Customer satisfaction score
- Support ticket volume

**Quarter 1:**
- Revenue impact (if monetized)
- Tenant retention improvement
- Feature adoption rate
- Expansion to other features

---

## 🔮 Future Enhancements (Backlog)

### V2 Features (Potential)

1. **Template Builder UI**
   - Drag-and-drop template editor
   - Button configuration (Call-to-Action, Quick Reply)
   - Header/footer support
   - Media attachments (images, videos)

2. **Advanced Segmentation**
   - Contact filters (by tags, custom fields)
   - Dynamic contact lists
   - A/B testing support

3. **Analytics Dashboard**
   - Campaign performance graphs
   - Delivery rate trends
   - Opt-out analysis
   - Best time to send insights

4. **Automation**
   - Scheduled campaigns
   - Recurring campaigns
   - Trigger-based campaigns (e.g., new customer signup)
   - Drip campaigns

5. **Integrations**
   - Zapier integration
   - Webhook triggers
   - API for external systems
   - CRM sync (Salesforce, HubSpot)

6. **Compliance Tools**
   - Auto opt-out handling
   - Quiet hours enforcement
   - Rate limiting per contact
   - Consent tracking

---

## 📚 Reference Documents

- [Master Implementation Guide](./WHATSAPP_BULK_MESSAGING_README.md)
- [Meta Setup Guide](./meta-whatsapp-setup-guide.md)
- [Implementation Progress](./IMPLEMENTATION_PROGRESS.md)
- [Phased Rollout Plan](./whatsapp-bulk-messaging-phased-plan.md)

---

## 🆘 Support & Help

### During Development
- Meta API Documentation: https://developers.facebook.com/docs/whatsapp
- Firebase Firestore Documentation: https://firebase.google.com/docs/firestore
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs

### Need Help?
If you encounter issues during setup or testing:
1. Check Vercel deployment logs
2. Review Firestore data in the Firebase console
3. Verify environment variables
4. Test API endpoints manually with Postman/Insomnia
5. Check Meta app status and logs

---

**Good luck with your launch! 🚀**
