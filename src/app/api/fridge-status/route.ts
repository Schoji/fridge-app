import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

// Never prerender — always read live data at request time.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProductRow = {
  name: string;
  expiration_date: string;
  quantity: number;
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

type Status = "expired" | "soon" | "fresh";

type Item = {
  name: string;
  expiration_date: string;
  quantity: number;
  days_left: number; // negative = past the date
  status: Status;
};

const STATUS_EMOJI: Record<Status, string> = {
  expired: "🔴",
  soon: "🟠",
  fresh: "🟢",
};

function formatDatePL(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function describeWhen(days: number): string {
  if (days < 0) {
    const d = Math.abs(days);
    return `${d} ${plural(d, "dzień", "dni", "dni")} po terminie`;
  }
  if (days === 0) return "dzisiaj";
  return `za ${days} ${plural(days, "dzień", "dni", "dni")}`;
}

function buildMessage(items: Item[], soonDays: number): string {
  const total = items.length;
  if (total === 0) {
    return "🧊 Lodówka jest pusta — brak produktów.";
  }

  const header = `🧊 Stan lodówki — ${total} ${plural(
    total,
    "produkt",
    "produkty",
    "produktów"
  )}:`;

  // Full inventory, already sorted by expiration date (soonest first).
  const list = items
    .map(
      (it) =>
        `${STATUS_EMOJI[it.status]} ${it.name} (${it.quantity} szt.) — ${describeWhen(
          it.days_left
        )} (${formatDatePL(it.expiration_date)})`
    )
    .join("\n");

  const parts = [header, list];

  const needsAttention = items.some((i) => i.status !== "fresh");
  if (!needsAttention) {
    parts.push(`✅ Nic nie wygasa w ciągu ${soonDays} dni.`);
  }

  return parts.join("\n\n");
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
    .select("name, expiration_date, quantity")
    .order("expiration_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  const todayUTC = todayInWarsawUTC();
  const rows = (data ?? []) as ProductRow[];

  const items: Item[] = rows.map((row) => {
    const days = daysUntil(row.expiration_date, todayUTC);
    const status: Status =
      days < 0 ? "expired" : days <= soonDays ? "soon" : "fresh";
    return {
      name: row.name,
      expiration_date: row.expiration_date,
      quantity: row.quantity,
      days_left: days,
      status,
    };
  });

  const expired = items.filter((i) => i.status === "expired");
  const expiring_soon = items.filter((i) => i.status === "soon");
  const fresh = items.filter((i) => i.status === "fresh");

  const message = buildMessage(items, soonDays);

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    summary: {
      total: items.length,
      expired: expired.length,
      expiring_soon: expiring_soon.length,
      fresh: fresh.length,
      within_days: soonDays,
    },
    items,
    expired,
    expiring_soon,
    message,
  });
}
