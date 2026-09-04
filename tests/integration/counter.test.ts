import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connection } from "./helpers";
import { format, nextNumber, peek } from "@/lib/services/counter";
import { prisma } from "@/lib/prisma";

/**
 * الترقيم تحت التزامن — تعريف إنجاز الخطوة 3.1:
 * «‏20 دفعة متوازية ← 20 رقماً فريداً بلا تكرار».
 *
 * رقما فاتورة متطابقان كارثة محاسبية، والفجوة مقبولة صراحةً (‏R34).
 */

let client: Client;
const YEAR = 2099; // سنة اختبار لا تتقاطع مع بيانات حقيقية

beforeAll(async () => {
  client = connection();
  await client.connect();
  await client.query(`delete from "Counter" where year = $1`, [YEAR]);
}, 60_000);

afterAll(async () => {
  await client.query(`delete from "Counter" where year = $1`, [YEAR]);
  await client.end().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}, 60_000);

const AT = new Date("2099-06-15T09:00:00.000Z"); // 12:00 بتوقيت بغداد

describe("الترقيم السنوي", () => {
  it("التنسيق يطابق R34", () => {
    expect(format("INV", 2026, 123)).toBe("INV-2026-000123");
    expect(format("CTR", 2026, 41)).toBe("CTR-2026-0041");
    expect(format("REQ", 2026, 45)).toBe("REQ-2026-000045");
  });

  it("يبدأ من 1 ويتصاعد", async () => {
    expect(await nextNumber("INV", undefined, AT)).toBe("INV-2099-000001");
    expect(await nextNumber("INV", undefined, AT)).toBe("INV-2099-000002");
    expect(await peek("INV", AT)).toBe(2);
  });

  it("كل نوع عدّاده المستقل", async () => {
    expect(await nextNumber("CTR", undefined, AT)).toBe("CTR-2099-0001");
    expect(await nextNumber("REQ", undefined, AT)).toBe("REQ-2099-000001");
    expect(await peek("INV", AT)).toBe(2); // لم يتأثّر
  });

  it("🔴 **20 طلباً متوازياً ← 20 رقماً فريداً بلا تكرار واحد**", async () => {
    const before = await peek("INV", AT);
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => nextNumber("INV", undefined, AT)),
    );

    expect(numbers).toHaveLength(20);
    expect(new Set(numbers).size, "تكرّر رقم فاتورة!").toBe(20);
    expect(await peek("INV", AT)).toBe(before + 20);

    // ومتتالية بلا فجوة حين لا تفشل أي معاملة
    const seq = numbers.map((n) => Number(n.split("-")[2])).sort((a, b) => a - b);
    expect(seq[0]).toBe(before + 1);
    expect(seq[19]).toBe(before + 20);
  }, 120_000);

  it("السنة **بتوقيت بغداد** لا بتوقيت الخادم", async () => {
    // 1/1/2099 الساعة 01:00 بغداد = 31/12/2098 الساعة 22:00 UTC.
    // الترقيم بتوقيت UTC كان سيعطي السنة 2098 — وهو رقم فاتورة بسنة خاطئة.
    const newYearBaghdad = new Date("2098-12-31T22:00:00.000Z");
    const n = await nextNumber("REQ", undefined, newYearBaghdad);
    expect(n.startsWith("REQ-2099-")).toBe(true);
  });
});
