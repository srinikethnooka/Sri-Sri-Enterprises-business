# Scan bill book

Orders → **Scan bill book** turns photos of the paper bill book into orders.

## How it works

1. Take a photo (or choose up to 30 photos) of bill pages.
2. Each photo is read by an AI vision model. Handwriting in English, Telugu or a mix is supported.
3. The app fills a form with what it read: book bill no., bill date, delivery date, customer name and mobile, items with qty and price, discount, advance, measurements and design notes.
4. It shows **Please check** warnings when something doesn't add up (items vs written total, total − advance vs balance, unclear date or phone, unreadable parts).
5. You check the form next to the photo, correct anything, choose where the order is now (Confirmed / In progress / Ready / Delivered) and tap **Save & next**.

On save the app:
- uses the existing customer with that mobile number, or creates a new one;
- saves the measurements to the customer (if ticked);
- creates the order **dated on the bill date**, with the book bill number;
- records the advance as a payment on the bill date;
- optionally issues an invoice (off by default for old bills already given on paper);
- keeps the bill photo with the order (team only).

The same book bill number cannot be entered twice. Nothing is saved until you tap Save.

## Setup (one time)

Reading handwriting needs an AI vision service. The app uses Anthropic's Claude API.

1. Create an API key at https://console.anthropic.com (add billing; each photo read costs a small amount — check current pricing on that site).
2. Store it as a Supabase secret (never in the frontend):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy scan-bill
   ```
3. Optional: choose the model with `supabase secrets set SCAN_MODEL=...` (default `claude-sonnet-5-5`; a smaller model is cheaper but reads handwriting less reliably).

Until the key is set, the page shows "Bill scanning is not set up yet".

## Privacy

Bill photos contain customer names and phone numbers. They are sent to Anthropic only to be read and are not stored by the scan function. Tell the owner this before enabling it. Only staff with **Create and update orders** permission can scan. Scans are limited to 120 per hour per boutique, and every scan is logged (`bill_scans`, owner only).

## Tips for good results

- One page per photo, flat, in daylight, whole page in the frame, no shadow across the writing.
- If a photo fails, tap **Try again** or retake it.
- Always compare the total in the form with the total on the photo before saving.
