import { InventoryUnavailableError, OrderNotFoundError } from "./errors";

export function findOrder(orderId: string): { id: string; total: number } {
  if (orderId === "missing") throw new OrderNotFoundError("Order was not found");
  return { id: orderId, total: 42 };
}

export function reserveInventory(orderId: string): void {
  if (orderId === "sold-out") {
    // Intentionally unmapped so the demo starts with a visible coverage gap.
    throw new InventoryUnavailableError("Inventory could not be reserved");
  }
}
