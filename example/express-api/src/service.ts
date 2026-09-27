import { PaymentDeclinedError } from "./errors";
import { findOrder, reserveInventory } from "./repository";

export function checkoutOrder(orderId: string): { confirmation: string } {
  const order = findOrder(orderId);
  reserveInventory(order.id);
  if (order.total > 40) throw new PaymentDeclinedError("Card was declined");
  return { confirmation: `confirmed-${order.id}` };
}
