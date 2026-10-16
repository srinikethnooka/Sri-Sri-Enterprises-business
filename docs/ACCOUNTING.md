# Accounting rules

These definitions are used by the dashboard, the Reports page and every export. They live in `report_summary()` (migration 0009).

## When things count

| Thing | Counted on | Notes |
|---|---|---|
| Sales | Invoice issue date (IST) | Cancelled invoices are excluded. A correction is a new invoice. |
| Collections | Payment `received_at` | Payments minus refunds, plus/minus reversals. |
| Stock bought | Purchase received date | An asset (stock), **not** an expense. |
| Materials cost | Frozen value of each use | Valued at weighted-average cost at that moment. |
| Labour / other direct cost | Entered per item by the owner | Part of the job cost. |
| Operating expenses | Expense date | Voided expenses excluded. |

## Formulas

```
Gross sales            = Σ qty × price on issued invoices
Discounts              = item discounts + order discounts
Net sales              = Gross sales − Discounts          (tax and delivery shown separately)
Gross profit           = Net sales − materials used on those orders − labour − other direct costs
Net operating profit   = Gross profit + delivery charges billed − operating expenses
                         − delivery costs paid − stock written off (waste, corrections)
Customers owe          = Σ over issued invoices of (total − payments on that order), if positive
Collections            = Σ payments − refunds ± reversals (by date received)
```

Costs are **matched** to revenue: the profit for a period uses the costs of the orders invoiced in that period, even if the material was used earlier.

## "Actual" vs "estimate"

Profit is labelled **Incomplete / Estimate** whenever any invoiced item in the period is not ticked "Done" in its job cost. Tick it once materials, labour and other costs are entered.

## Weighted-average costing

On every incoming stock movement with a cost:

```
new average = (stock on hand × old average + qty in × unit cost) ÷ (stock on hand + qty in)
```

If stock was zero or below, the new average is the incoming cost. Outgoing stock (use, waste, returns to supplier) is valued at the current average, and that value is frozen on the movement, so later price changes never alter past orders.

**Landed cost:** a purchase's discount and transport/other charges are spread over its items by value, so stock carries what it really cost.

## Cash vs profit

- An **advance** increases collections now; the sale counts when the invoice is issued.
- An **unpaid invoice** is a sale now and increases "customers owe"; the cash comes later.
- **Buying stock** reduces cash now; it becomes cost only when used on an order.
- **Supplier credit**: purchases increase "we owe the supplier"; supplier payments reduce it.
- **Refunds** reduce collections. If the order is also cancelled, cancel its invoice so the sale is removed.

## Tax

Off by default. When on, tax is charged on (items − order discount) at the configured rate, shown separately and excluded from net sales. Issued invoices keep the tax they were issued with.

## Rounding

Totals are rounded to the nearest rupee by default; the difference appears as "Round off" on the invoice. All money is stored as `numeric(12,2)`; quantities as `numeric(12,3)`; average cost as `numeric(12,4)`.

## Corrections

| Mistake | Fix |
|---|---|
| Wrong price on an issued invoice | Cancel invoice (reason) → edit order → issue corrected invoice (new number, linked to the old one) |
| Payment entered wrongly | Reverse it (reason). Both rows stay. |
| Money given back | Refund (reason) |
| Material used by mistake | Return to stock against the same item |
| Stock count wrong | Adjustment (reason) |
| Expense wrong | Edit (audited) or Void (reason) |
