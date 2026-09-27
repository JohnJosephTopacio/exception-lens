import { OrderNotFoundError, PaymentDeclinedError } from "./errors";
import { checkoutOrder } from "./service";

interface Router {
  post(path: string, handler: (req: any, res: any, next: any) => unknown): void;
  get(path: string, handler: (req: any, res: any, next: any) => unknown): void;
  use(handler: (err: Error, req: any, res: any, next: any) => unknown): void;
}

declare const router: Router;

function checkout(req: any, res: any, next: any): void {
  try {
    const result = checkoutOrder(req.params.orderId);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

router.post("/orders/:orderId/checkout", checkout);

function errorMiddleware(err: Error, _req: any, res: any, _next: any): unknown {
  if (err instanceof OrderNotFoundError) {
    return res.status(404).json({ error: "ORDER_NOT_FOUND", message: err.message });
  }
  if (err instanceof PaymentDeclinedError) {
    return res.status(402).json({ error: "PAYMENT_DECLINED", message: err.message });
  }
  return res.status(500).json({ error: "INTERNAL_ERROR" });
}

router.use(errorMiddleware);
