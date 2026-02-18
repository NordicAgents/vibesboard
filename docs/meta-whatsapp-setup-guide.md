# Meta WhatsApp Business Account Setup Guide

**Purpose:** This guide explains how to set up Meta WhatsApp Business API access for your tenants.

**Audience:** Developers, Tenant Admins, or Super Admins setting up WhatsApp Business accounts

**Time Required:** 30-60 minutes per account

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Create Meta Business Account](#step-1-create-meta-business-account)
- [Step 2: Create App in Meta for Developers](#step-2-create-app-in-meta-for-developers)
- [Step 3: Add WhatsApp Product](#step-3-add-whatsapp-product)
- [Step 4: Get Phone Number](#step-4-get-phone-number)
- [Step 5: Get Access Credentials](#step-5-get-access-credentials)
- [Step 6: Configure Webhooks](#step-6-configure-webhooks)
- [Step 7: Verify Account in VibeAgent](#step-7-verify-account-in-vibeagent)
- [Step 8: Create Message Templates](#step-8-create-message-templates)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, you need:

1. **Meta Account** (personal Facebook/Meta account)
2. **Business Verification Documents** (for production):
   - Business registration certificate
   - Business address proof
   - Tax ID or business license
3. **Phone Number** for WhatsApp (separate from your personal WhatsApp)
4. **Credit Card** (Meta may require for Business Account verification)

---

## Step 1: Create Meta Business Account

### 1.1 Go to Meta Business Suite

🔗 [https://business.facebook.com/](https://business.facebook.com/)

Click **"Create Account"** and fill in:
- Business name
- Your name
- Business email

### 1.2 Business Verification (Optional for Testing, Required for Production)

**For Testing/Development:**
- You can use an unverified account
- Messaging limits: 250 messages/24 hours
- Cannot send to users who haven't initiated conversation first

**For Production:**
- Submit business verification documents
- Approval takes 1-3 business days
- Unlocks higher messaging tiers (1K → 10K → 100K+/day)

**How to Verify:**
1. Go to **Business Settings** → **Security Center**
2. Click **"Start Verification"**
3. Upload documents:
   - Business registration certificate
   - Proof of business address
   - Tax ID
4. Wait for approval email

---

## Step 2: Create App in Meta for Developers

### 2.1 Go to Meta for Developers

🔗 [https://developers.facebook.com/](https://developers.facebook.com/)

Login with your Meta account (same as Business Account).

### 2.2 Create New App

1. Click **"My Apps"** → **"Create App"**
2. Select **"Business"** as app type
3. Fill in app details:
   - **Display Name:** `[Your Company] WhatsApp API`
   - **Contact Email:** Your business email
   - **Business Account:** Select the Business Account you created
4. Click **"Create App"**

### 2.3 Note Your App ID

After creation, you'll see your **App ID** at the top. Save this.

---

## Step 3: Add WhatsApp Product

### 3.1 Add WhatsApp to Your App

1. In your app dashboard, find **"WhatsApp"** under **"Add Products"**
2. Click **"Set Up"**
3. Meta will guide you through the WhatsApp setup wizard

### 3.2 Link WhatsApp Business Account

1. Select **"Create a new WhatsApp Business Account"** or choose existing
2. Fill in business details:
   - **Business Display Name:** This will be visible to users
   - **Category:** Select your business category
   - **Description:** Brief description of your business
   - **Website:** Your company website
3. Click **"Continue"**

---

## Step 4: Get Phone Number

### 4.1 Add a Phone Number

**Option A: Meta Provided Test Number (Development Only)**
- Meta gives you a test number: `+1 555 025 3111`
- Can send messages to **up to 5 verified test numbers**
- Not suitable for production

**Option B: Your Own Phone Number (Recommended for Production)**

1. Click **"Add Phone Number"**
2. Select country code
3. Enter phone number (must not be registered on WhatsApp)
4. Click **"Next"**

### 4.2 Verify Phone Number

1. Meta will send a **6-digit verification code** via SMS
2. Enter the code in the verification field
3. Click **"Verify"**

⚠️ **Important:** Once verified, this number is now a **WhatsApp Business Account** and cannot be used as a regular WhatsApp number.

### 4.3 Note Your Phone Number ID

After verification, you'll see:
- **Phone Number ID:** `123456789012345` (save this!)
- **Display Phone Number:** `+1234567890`

---

## Step 5: Get Access Credentials

### 5.1 Get Temporary Access Token (Development)

1. Go to **WhatsApp** → **Getting Started** → **Send and receive messages**
2. You'll see a **Temporary access token** (valid for 24 hours)
3. Copy this token

⚠️ **For Development Only:** This token expires in 24 hours. For production, you need a **System User Token** (see 5.2).

### 5.2 Create System User Token (Production)

**Why?** System user tokens don't expire and are more secure.

#### Step A: Create System User

1. Go to **Business Settings** (business.facebook.com)
2. Click **"Users"** → **"System Users"**
3. Click **"Add"**
4. Fill in:
   - **Name:** `WhatsApp API System User`
   - **Role:** **Admin**
5. Click **"Create System User"**

#### Step B: Assign WhatsApp Assets

1. Click on your system user
2. Click **"Add Assets"**
3. Select **"Apps"** → Choose your app → **Full Control**
4. Select **"WhatsApp Accounts"** → Choose your WhatsApp Business Account → **Full Control**
5. Click **"Save Changes"**

#### Step C: Generate Access Token

1. Click **"Generate New Token"**
2. Select your **App**
3. Set expiration:
   - **60 days** (good for staging)
   - **Never expire** (only for production with strict security)
4. Select permissions:
   - ✅ `whatsapp_business_management`
   - ✅ `whatsapp_business_messaging`
5. Click **"Generate Token"**
6. **Copy and save immediately** (you can't see it again!)

### 5.3 Get Business Account ID

1. Go to **WhatsApp** → **Getting Started**
2. Find **"Business Account ID"** (looks like `109876543210987`)
3. Save this

---

## Step 6: Configure Webhooks

### 6.1 Why Webhooks?

Webhooks let Meta notify your app when:
- Messages are delivered
- Messages are read
- Users reply to messages
- Message status changes (failed, etc.)

### 6.2 Set Up Webhook Endpoint

**In VibeAgent:**

Your webhook endpoint is:
```
https://your-domain.com/api/webhooks/whatsapp-bulk
```

**Generate Verify Token:**
```bash
openssl rand -hex 32
```
Save this as `WHATSAPP_VERIFY_TOKEN` in your `.env.local`.

### 6.3 Configure in Meta

1. Go to **WhatsApp** → **Configuration** → **Webhook**
2. Click **"Edit"**
3. Fill in:
   - **Callback URL:** `https://your-domain.com/api/webhooks/whatsapp-bulk`
   - **Verify Token:** Your generated token from above
4. Click **"Verify and Save"**

⚠️ **Meta will send a GET request** to verify your webhook. Your endpoint must respond correctly (VibeAgent handles this automatically).

### 6.4 Subscribe to Webhook Fields

After verification, subscribe to:
- ✅ `messages` (incoming messages)
- ✅ `message_delivery` (delivery status)
- ✅ `message_read` (read receipts)
- ✅ `message_status` (failed, sent, etc.)

---

## Step 7: Verify Account in VibeAgent

### 7.1 Add Credentials to VibeAgent

1. Login to VibeAgent as **Tenant Admin**
2. Go to **Settings** → **WhatsApp Bulk Messaging** (only visible if feature is enabled by Super Admin)
3. Click **"Connect WhatsApp Business Account"**
4. Fill in:
   - **Phone Number ID:** From Step 4.3
   - **Business Account ID:** From Step 5.3
   - **Access Token:** From Step 5.1 or 5.2
   - **Display Name:** Optional friendly name
5. Click **"Connect"**

### 7.2 Verify Connection

VibeAgent will:
1. Call Meta Graph API to verify credentials
2. Fetch account details (quality rating, messaging limits)
3. Store encrypted access token in database
4. Display connection status

**If successful, you'll see:**
- ✅ **Status:** Verified
- Quality Rating: **GREEN**
- Messaging Limit: **TIER_1K** (or higher)

---

## Step 8: Create Message Templates

### 8.1 Why Templates?

WhatsApp requires **pre-approved templates** for promotional/marketing messages sent outside 24-hour conversation windows.

### 8.2 Create Template in VibeAgent

1. Go to **WhatsApp Bulk Messaging** → **Templates**
2. Click **"Create Template"**
3. Fill in:
   - **Name:** `summer_sale_2024` (lowercase, underscores only)
   - **Category:** Marketing
   - **Language:** English
   - **Body:**
     ```
     Hi {{1}}, enjoy {{2}}% off on your next purchase! Valid until {{3}}.
     ```
   - **Footer:** `Reply STOP to unsubscribe`
   - **Variables:** `customer_name`, `discount_amount`, `expiry_date`
   - **Button (optional):** [Shop Now] → https://your-store.com/sale
4. Click **"Submit to Meta"**

### 8.3 Wait for Approval

- **Approval Time:** 24-48 hours
- **Check Status:** VibeAgent → Templates → Click **"Sync Status"**
- **If Rejected:** You'll see rejection reason. Fix and resubmit.

### 8.4 Template Best Practices

✅ **Do:**
- Keep messages concise and clear
- Provide value to recipients
- Use personalization ({{1}}, {{2}})
- Include opt-out instructions
- Use descriptive variable names

❌ **Don't:**
- Use overly promotional language ("Buy now!", "Limited time!")
- Make misleading claims
- Exceed 1024 characters
- Use all caps
- Include spam keywords

---

## Credentials Summary

After completing all steps, you should have:

| Credential | Example Value | Where to Store |
|------------|---------------|----------------|
| **App ID** | `123456789012345` | Reference only |
| **Phone Number ID** | `109876543210987` | VibeAgent connection form |
| **Business Account ID** | `987654321098765` | VibeAgent connection form |
| **Access Token** | `EAAG...` (long string) | VibeAgent connection form (encrypted in DB) |
| **Verify Token** | `abc123...` (32 chars) | `.env.local` as `WHATSAPP_VERIFY_TOKEN` |
| **Display Phone Number** | `+1234567890` | Auto-fetched by VibeAgent |

---

## Troubleshooting

### Issue: "Invalid Phone Number ID"

**Cause:** Wrong Phone Number ID or token doesn't have access.

**Solution:**
1. Double-check Phone Number ID from **WhatsApp → Getting Started**
2. Ensure system user has **Full Control** over WhatsApp Business Account
3. Regenerate access token with correct permissions

---

### Issue: "Webhook Verification Failed"

**Cause:** Webhook endpoint not responding correctly.

**Solution:**
1. Ensure your app is deployed and accessible
2. Check webhook endpoint logs: `/api/webhooks/whatsapp-bulk`
3. Verify token matches in Meta and `.env.local`
4. Test webhook manually:
   ```bash
   curl "https://your-domain.com/api/webhooks/whatsapp-bulk?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=TEST"
   ```
   Should return: `TEST`

---

### Issue: "Template Rejected"

**Common Reasons:**
- Too promotional ("Buy now!", "Limited offer!")
- Contains spam keywords
- Misleading content
- Grammar/spelling errors
- Missing opt-out instructions

**Solution:**
1. Review Meta's [template guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/)
2. Revise template to be more informative than promotional
3. Resubmit

---

### Issue: "Message Failed: Error Code 131026"

**Cause:** Recipient's phone number not registered on WhatsApp.

**Solution:**
- Verify phone numbers before adding to contact lists
- Use E.164 format: `+1234567890`
- Remove invalid numbers from lists

---

### Issue: "Rate Limit Exceeded"

**Cause:** Sending too many messages too quickly.

**Tier Limits:**
- **TIER_1K:** 1,000 messages/24 hours
- **TIER_10K:** 10,000 messages/24 hours
- **TIER_100K:** 100,000 messages/24 hours

**Solution:**
1. Check your current tier: **WhatsApp → Getting Started → Phone Number Quality**
2. Maintain **GREEN** quality rating to increase tier
3. Wait 7-30 days with good quality to upgrade tier
4. In VibeAgent, reduce **max_messages_per_second** in campaign settings

---

## Next Steps

After completing this setup:

1. ✅ **Test with a Single Message**
   - Create a test campaign with 1 recipient
   - Verify message is sent, delivered, and read

2. ✅ **Import Contacts**
   - Go to **Contacts** → **Import CSV**
   - Ensure contacts have opted in

3. ✅ **Create First Campaign**
   - Use an approved template
   - Select small contact list (10-50 contacts)
   - Monitor results

4. ✅ **Scale Gradually**
   - Start with small campaigns (100-500 messages)
   - Monitor quality rating (keep it GREEN)
   - Increase volume as tier upgrades

---

## Useful Resources

- **Meta WhatsApp Business API Docs:** https://developers.facebook.com/docs/whatsapp/cloud-api/
- **Message Templates Guidelines:** https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/
- **Error Codes Reference:** https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
- **Business Verification:** https://www.facebook.com/business/help/159334372093366

---

**Document Version:** 1.0
**Last Updated:** 2024-02-15
**Maintained By:** VibeAgent Development Team
