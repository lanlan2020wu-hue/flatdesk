import { saveCustomerProfileAction } from "@/app/app/customers/actions";
import { CUSTOMER_NOTES_MAX } from "@/lib/customer-profile";

// The team's notes on a customer, in the ticket's side rail. Shown as text;
// "Edit" opens the form. Opens by itself when there's a problem to show.
export function CustomerProfile({ customerId, number, notes, vip, canEdit, error }: { customerId: string; number: number; notes: string; vip: boolean; canEdit: boolean; error: string | null }) {
  if (!canEdit && !notes) return null;
  return (
    <div className="grid gap-1.5 pt-1">
      {notes && <p className="line-clamp-6 whitespace-pre-line break-words rounded-lg border border-line bg-surface-2 px-3 py-2 text-muted">{notes}</p>}
      {canEdit && (
        <details open={Boolean(error)} className="group">
          <summary className="link w-max cursor-pointer list-none text-xs">{notes || vip ? "Edit notes" : "Add a note about this customer"}</summary>
          <form action={saveCustomerProfileAction} className="mt-2 grid gap-2">
            <input type="hidden" name="customerId" value={customerId} />
            <input type="hidden" name="number" value={number} />
            <label htmlFor="customer-notes" className="sr-only">Notes about this customer</label>
            <textarea
              id="customer-notes"
              name="notes"
              rows={4}
              maxLength={CUSTOMER_NOTES_MAX}
              defaultValue={notes}
              placeholder="Prefers phone. On the annual plan, renews in March."
              className="field"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="vip" defaultChecked={vip} className="size-4 accent-[var(--accent)]" />
              VIP: mark their tickets in the inbox
            </label>
            {error && <p role="alert" className="text-xs text-warn">{error}</p>}
            <button className="btn btn-secondary btn-sm w-fit">Save</button>
          </form>
        </details>
      )}
    </div>
  );
}
