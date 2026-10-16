# Sending bills on WhatsApp automatically

When this is set up and switched on, saving an invoice sends the bill to the customer on WhatsApp straight away. Nobody has to open WhatsApp.

- If the customer's number **is on WhatsApp**: they receive the message with the invoice PDF attached. The order page shows **Sent → Delivered → Read** as WhatsApp reports it.
- If the number **is not on WhatsApp**: WhatsApp reports it as undeliverable. The app marks the customer "Not on WhatsApp", the bill stays saved in the records, and next time it doesn't try again for that number.
- If it **isn't set up yet**: bills are saved as usual and the manual **Share by hand** screen still works.

There is no way to check a number before sending. WhatsApp tells the app after the first message, and the customer page then shows "On WhatsApp" or "Not on WhatsApp".

## What you need (one time)

1. **A Meta Business account** (business.facebook.com) for Sri Sri Boutique.
2. **The WhatsApp Business Platform (Cloud API)** connected to the shop's number **+91 89190 93604**.
   - With **Coexistence**, the same number keeps working in the WhatsApp Business app on the phone. Connect it through Meta's embedded signup or a Meta partner that supports Coexistence.
3. **An approved message template.** WhatsApp only lets businesses start a conversation with an approved template. Create it in WhatsApp Manager → Message templates:
   - Name: `invoice_with_pdf` · Category: **Utility** · Language: **English**
   - Header: **Document**
   - Body (exactly six values, in this order):
     ```
     Hello {{1}}, thank you for choosing Sri Sri Boutique!
     Your order {{2}} is confirmed.
     Invoice total: {{3}}
     Amount paid: {{4}}
     Balance due: {{5}}
     Expected delivery: {{6}}
     Your invoice is attached. Thank you!
     ```
   - Wait for approval (usually minutes to a day).
4. **A permanent access token** (System user token with `whatsapp_business_messaging` permission) and the **Phone number ID** from WhatsApp Manager → API setup.

## Connect it to the app

```bash
supabase secrets set WHATSAPP_TOKEN=<permanent token>
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<phone number id>
supabase secrets set WHATSAPP_APP_SECRET=<Meta app secret>
supabase secrets set WHATSAPP_VERIFY_TOKEN=<any long random text you choose>
supabase functions deploy whatsapp-send
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

Then in the Meta app dashboard → WhatsApp → Configuration → Webhook:
- Callback URL: `https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook`
- Verify token: the same `WHATSAPP_VERIFY_TOKEN`
- Subscribe to **messages**.

Finally, in the app: **Settings → Business → Send bills on WhatsApp automatically** → tick it → Save. The page shows "WhatsApp Business connection is set up" when the server is ready.

Optional: `WHATSAPP_API_VERSION` (default `v21.0`) if Meta asks you to use a newer Graph API version.

## Cost

Meta charges for business-started (template) messages. Check the current rates for India in WhatsApp Manager before switching on. The app limits sending to 300 messages per hour per boutique.

## Privacy

Customer names, amounts and the invoice PDF go through Meta's WhatsApp service. The PDF link given to WhatsApp is private and expires after 24 hours.
