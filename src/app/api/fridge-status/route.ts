import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Never prerender — always read live data at request time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProductRow = {
  name: string;
  expiration_date: string;
};

const DEFAULT_SOON_DAYS = 3;

// "Today" anchored to the user's timezone so day counts match the UI, which
// runs in the browser's local time (Poland).
function todayInWarsawUTC(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = parts.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysUntil(dateStr: string, todayUTC: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const expiryUTC = Date.UTC(y, m - 1, d);
  return Math.round((expiryUTC - todayUTC) / 86_400_000);
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function buildMessage(
  expired: { name: string; days_overdue: number }[],
  soon: { name: string; days_left: number }[],
  total: number
): string {
  if (expired.length === 0 && soon.length === 0) {
    return `✅ W lodówce wszystko w porządku — nic nie wygasa w ciągu ${DEFAULT_SOON_DAYS} dni. Produktów łącznie: ${total}.`;
  }

  const lines: string[] = ["🧊 Stan lodówki:"];

  if (expired.length > 0) {
    lines.push(
      `\n🔴 Przeterminowane (${expired.length} ${plural(
        expired.length,
        "produkt",
        "produkty",
        "produktów"
      )}):`
    );
    for (const p of expired) {
      const d = Math.abs(p.days_overdue);
      lines.push(
        `  • ${p.name} — ${d} ${plural(d, "dzień", "dni", "dni")} po terminie`
      );
    }
  }

  if (soon.length > 0) {
    lines.push(`\n🟠 Wkrótce wygasa (${soon.length}):`);
    for (const p of soon) {
      const when =
        p.days_left === 0
          ? "dzisiaj"
          : `za ${p.days_left} ${plural(p.days_left, "dzień", "dni", "dni")}`;
      lines.push(`  • ${p.name} — ${when}`);
    }
  }

  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  // Bearer-token auth. Hermes (or a cron job) must send
  // `Authorization: Bearer <HERMES_API_TOKEN>`.
  const expected = process.env.HERMES_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "HERMES_API_TOKEN is not configured on the server" },
      { status: 500 }
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const within = Number(
    request.nextUrl.searchParams.get("within") ?? DEFAULT_SOON_DAYS
  );
  const soonDays = Number.isFinite(within) && within >= 0 ? within : DEFAULT_SOON_DAYS;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("products")
    .select("name, expiration_date")
    .order("expiration_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const todayUTC = todayInWarsawUTC();
  const rows = (data ?? []) as ProductRow[];

  const expired: { name: string; expiration_date: string; days_overdue: number }[] = [];
  const expiring_soon: { name: string; expiration_date: string; days_left: number }[] = [];
  let freshCount = 0;

  for (const row of rows) {
    const days = daysUntil(row.expiration_date, todayUTC);
    if (days < 0) {
      expired.push({
        name: row.name,
        expiration_date: row.expiration_date,
        days_overdue: days,
      });
    } else if (days <= soonDays) {
      expiring_soon.push({
        name: row.name,
        expiration_date: row.expiration_date,
        days_left: days,
      });
    } else {
      freshCount += 1;
    }
  }

  const message = buildMessage(expired, expiring_soon, rows.length);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    summary: {
      total: rows.length,
      expired: expired.length,
      expiring_soon: expiring_soon.length,
      fresh: freshCount,
      within_days: soonDays,
    },
    expired,
    expiring_soon,
    message,
  });
}
