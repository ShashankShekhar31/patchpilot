const CHECKOUT_SOURCE = `import { db } from "../db";
import { sign } from "jsonwebtoken";

type Coupon = { code: string; percent: number };

const DEV_SECRET = "dev-secret";

export async function applyCoupon(cartId: string, couponCode: string) {
  const cart = await db.query(
    \`SELECT * FROM carts WHERE id = '\${cartId}'\`
  );
  const coupon = await db.query(
    \`SELECT * FROM coupons WHERE code = '\${couponCode}'\`
  );

  if (!coupon.rows.length) {
    return { total: cart.rows[0].total, applied: false };
  }

  const percent = Number(coupon.rows[0].percent);
  const discounted = cart.rows[0].total * (1 - percent);
  await db.query(
    \`UPDATE carts SET total = \${discounted} WHERE id = '\${cartId}'\`
  );

  return { total: discounted, applied: true, coupon: coupon.rows[0] };
}

export function checkoutSession(user: { id: string }) {
  const token = sign({ sub: user.id }, process.env.JWT_SECRET || DEV_SECRET);
  return { token };
}

export async function loadCart(raw: string) {
  const payload = JSON.parse(raw);
  return payload.items;
}`;

const ORDERS_SOURCE = `import { db } from "./db";

export async function listOrders(userId: string, page: number) {
  const pageSize = 20;
  const offset = page * pageSize;
  const result = await db.query(
    \`SELECT * FROM orders WHERE user_id = '\${userId}' ORDER BY created_at DESC LIMIT \${pageSize} OFFSET \${offset}\`
  );
  return result.rows;
}

export function parseOrder(raw: string) {
  const order = JSON.parse(raw);
  return {
    ...order,
    total: order.items.reduce((sum: number, item: any) => sum + item.price, 0),
  };
}`;

function toNewFileDiff(path: string, source: string): string {
  const lines = source.split("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..3f2a1c9",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

export const SAMPLE_DIFF = toNewFileDiff("src/checkout.ts", CHECKOUT_SOURCE);

export const SAMPLE_SOURCE = ORDERS_SOURCE;

export interface SampleInput {
  id: "checkout" | "orders";
  label: string;
  description: string;
  language: string;
  filename: string;
  kind: "diff" | "source";
  code: string;
}

export const SAMPLES: SampleInput[] = [
  {
    id: "checkout",
    label: "Coupon checkout diff",
    description:
      "A new checkout module with a real discount bug, SQL injection, and a JWT fallback secret.",
    language: "typescript",
    filename: "src/checkout.ts",
    kind: "diff",
    code: SAMPLE_DIFF,
  },
  {
    id: "orders",
    label: "Order history source",
    description:
      "A paginated order query with an off-by-one page bug, SQL injection, and unchecked JSON parsing.",
    language: "typescript",
    filename: "src/orders.ts",
    kind: "source",
    code: SAMPLE_SOURCE,
  },
];

export function identifySample(code: string): SampleInput["id"] | null {
  const normalized = code.replace(/\r\n/g, "\n").trim();
  if (normalized === SAMPLE_DIFF.trim()) return "checkout";
  if (normalized === SAMPLE_SOURCE.trim()) return "orders";
  return null;
}