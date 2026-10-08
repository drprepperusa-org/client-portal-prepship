# Client Portal Customs/Duties

Adds Customs/Duties immediately after Shipping in Billing periods, line items,
and the printable invoice. Excel and CSV continue to pass through PrepShip's
own files. No portal editing action or charge calculation is added.

## Placement and data boundary

- Business rule: display the exact duty charge and total already issued by PrepShip.
- Canonical owners: PrepShip `billingDetails` / `toBillingDetailOrderRows` and
  `billingInvoiceHeaderTotals`, verified against pulled commit
  `0e17f480c427b66571e1966228c6a6eddf3fdc48`.
- Missing-data entry point: the portal's upstream allowlist and final DTO projection
  previously discarded `customsDutiesTotal` and `hasCustomsDutiesLine`.
- Consumers: billing details proxy, canonical invoice projection, invoice summary
  and print routes, period presentation, line-item columns, printable HTML.
- Formula: the portal carries PrepShip `grandTotal` as `rowTotal`; duties are
  already included. It must not add duties again or reconstruct fulfillment fees.
  The existing backend period footer sums canonical period categories; an unknown
  duty category keeps the duty footer unknown.
- Clock/scope: existing inclusive billing-day range, client scope and authenticated
  bearer are forwarded unchanged. Sorting delegates to `customsDutiesTotal`.
- Presence: a recorded zero displays `$0.00`; an absent charge displays a dash.
  A pre-feature producer omitting both duty fields remains readable with null
  duty data. Partial/malformed pairs reject the response. No guessed zero or
  country-based eligibility is introduced.
- Frontend role: format and display DTO fields, send sort intent. No new business
  wrapper, fallback calculation, billing write, or PrepShip source modification.

## Verification

`scripts/fixtures/generate-customs-duties.mts <prepship-repository>` runs the
actual committed producer's pure row owner and records its SHA and fixture hash.
It reads Git objects, not a database or an uncommitted working tree.

The new `test:client-portal-customs-duties` exercises those seven producer rows
through the portal allowlist, DTO and printable cells: split shipments, nonzero
duties, explicit zero, absent duty, cancellation, independent returns, exact cents,
full-period totals versus a single page, sorting, bearer/client/day forwarding,
internal-field redaction, and malformed-response rejection.

Browser coverage in `client-portal-cp059-billing.spec.js` checks summary/footer,
detail values, sorting requests, absence versus zero, unchanged row totals, and
print table alignment. Existing producer-contract print assertions were shifted
for the new column without changing their money expectations.

Validation passed: root/frontend typecheck, frontend production build, the new
boundary test, canonical billing and producer-contract guards, invoice totals,
column order, sorting/pagination, billing totals, architecture/shadow-renderer,
and invoice-export pass-through guards, plus canonical summary assignment and
contract drift checks. All 12 distinct billing browser cases passed (11 in the
full billing run, followed by the two Customs/Duties cases after adding the print
case). The print screenshot was inspected: all 20 columns and eight summary
cards fit without horizontal clipping.

Scope is local source and offline/mock tests only. No production mutations,
labels, postage, printing, marketplace notifications, push or deployment.

## Follow-up: item quantity display

The portal's `toPortalDetailRow` discarded PrepShip `displayQty` and instead exposed
raw billing-line `qty`, so a fee line with quantity 1 hid an order's three or four
item units. The canonical owners are PrepShip `summarizeBillingItemsForDetail`
and `toBillingDetailOrderRows`; they already issue the correct display quantity.
The portal projection now delegates directly to `displayQty`. The grid, print row
and existing backend print quantity footer consume that DTO. Qty sort intent maps
to PrepShip `displayQty`, matching its own Billing view; unpaged display sorting
normalizes that numeric string, including fractions. No SKU-text parsing, frontend
item summation, or fallback to billing-line quantity is permitted.

The producer fixture now includes two more cases (nine total rows): Booster-gel-001
quantity 2 plus HU-10 quantity 1, and Booster-gel-001 quantity 4. Both retain raw
fee quantity 1 while producing display quantities 3 and 4. Boundary and print
assertions verify the projection; a browser test checks both values and upstream
sort intent. Typecheck, producer contract, sort/pagination, table sorting and
architecture checks passed. This quantity fix is local and not deployed.
