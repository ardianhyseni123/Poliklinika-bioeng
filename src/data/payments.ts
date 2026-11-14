import { collection, doc, setDoc, type Firestore, type Unsubscribe } from 'firebase/firestore';
import { validated, watchQuery, type DataContext, type Snapshot, type Written } from './context';
import { PaymentSchema, type Payment } from './schemas';

export type NewPayment = Pick<Payment, 'patientId' | 'patientName' | 'amount' | 'status' | 'paymentDate' | 'note'> & {
  reportId: string;
  reportLabel: string;
  reportTotal: number;
};

/** Laboratory only. */
export function watchPayments(db: Firestore, onData: (snapshot: Snapshot<Payment>) => void, onError: (error: Error) => void): Unsubscribe {
  return watchQuery(collection(db, 'payments'), data => PaymentSchema.safeParse(data), onData, onError);
}

/** Rescue of old-app data: writes a payment with its existing id, recorded by the current person. */
export function restorePayment(ctx: DataContext, input: Record<string, unknown>): Written<Payment> {
  const payment = validated('Pagesa', PaymentSchema.safeParse({ ...input, recordedBy: ctx.actor.email }));
  const path = `payments/${payment.id}`;
  const done = setDoc(doc(ctx.db, path), payment);
  ctx.tracker.track({ id: `payment:${payment.id}`, label: `Pagesë: ${payment.patientName} (${payment.amount} €)`, check: { path, expect: 'exists' }, content: payment }, done);
  return { record: payment, done };
}

/** Payments are recorded once and never edited; the signed-in person is recorded as the author. */
export function createPayment(ctx: DataContext, input: NewPayment): Written<Payment> {
  const payment = validated('Pagesa', PaymentSchema.safeParse({
    ...input,
    id: ctx.newId(),
    recordedAt: ctx.now(),
    recordedBy: ctx.actor.email
  }));
  const path = `payments/${payment.id}`;
  const done = setDoc(doc(ctx.db, path), payment);
  ctx.tracker.track({ id: `payment:${payment.id}`, label: `Pagesë: ${payment.patientName} (${payment.amount} €)`, check: { path, expect: 'exists' }, content: payment }, done);
  return { record: payment, done };
}
