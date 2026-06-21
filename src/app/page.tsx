"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-client";

type Product = {
  id: string;
  name: string;
  expiration_date: string;
  image_url: string | null;
};

const PRODUCT_REFRESH_INTERVAL_MS = 5000;

function daysUntilExpiry(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr + "T00:00:00");
  return Math.round(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function StatusBadge({ days }: { days: number }) {
  if (days < 0)
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-950 text-red-400 whitespace-nowrap">
        Pilne!
      </span>
    );
  if (days <= 3)
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#3D2C00] text-amber-400 whitespace-nowrap">
        Wygasa wkrótce
      </span>
    );
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#052E16] text-green-400 whitespace-nowrap">
      Świeży
    </span>
  );
}

function sortProducts(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const dateCompare = a.expiration_date.localeCompare(b.expiration_date);
    if (dateCompare !== 0) return dateCompare;
    return a.name.localeCompare(b.name, "pl", { sensitivity: "base" });
  });
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function NoImageIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-8 h-8 text-[#555]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </svg>
  );
}

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  const stats = useMemo(() => {
    const expiring = products.filter(
      (p) => daysUntilExpiry(p.expiration_date) <= 3
    ).length;
    const fresh = products.filter(
      (p) => daysUntilExpiry(p.expiration_date) > 3
    ).length;
    return { total: products.length, expiring, fresh };
  }, [products]);

  const visibleProducts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase("pl-PL");
    if (!normalizedQuery) return products;
    return products.filter((product) =>
      product.name.toLocaleLowerCase("pl-PL").includes(normalizedQuery)
    );
  }, [products, searchQuery]);

  const loadProducts = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, name, expiration_date, image_url")
      .order("expiration_date", { ascending: true });

    if (!error) setProducts(sortProducts(data ?? []));
    setLoading(false);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    void loadProducts();

    function refreshVisibleList() {
      if (document.visibilityState === "visible") {
        void loadProducts();
      }
    }

    const channel = supabase
      .channel("products-live-list")
      .on<Product>(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        (payload) => {
          setProducts((current) => {
            if (payload.eventType === "DELETE") {
              return current.filter((product) => product.id !== payload.old.id);
            }

            const incoming = payload.new;
            if (!incoming?.id) return current;

            const withoutIncoming = current.filter(
              (product) => product.id !== incoming.id
            );
            return sortProducts([...withoutIncoming, incoming]);
          });
        }
      )
      .subscribe((status) => {
        if (
          status === "SUBSCRIBED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          void loadProducts();
        }
      });

    window.addEventListener("focus", refreshVisibleList);
    document.addEventListener("visibilitychange", refreshVisibleList);
    const refreshInterval = window.setInterval(
      refreshVisibleList,
      PRODUCT_REFRESH_INTERVAL_MS
    );

    return () => {
      window.removeEventListener("focus", refreshVisibleList);
      document.removeEventListener("visibilitychange", refreshVisibleList);
      window.clearInterval(refreshInterval);
      void supabase.removeChannel(channel);
    };
  }, [loadProducts]);

  async function handleDelete(product: Product) {
    if (!confirm(`Usunąć "${product.name}"?`)) return;
    setDeleting(product.id);
    const supabase = createClient();

    if (product.image_url) {
      const path = product.image_url.split("/product-images/")[1];
      if (path) await supabase.storage.from("product-images").remove([path]);
    }

    await supabase.from("products").delete().eq("id", product.id);
    setProducts((prev) => prev.filter((p) => p.id !== product.id));
    setDeleting(null);
  }

  async function handleSignOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#111213]">
        <span className="text-[#555] text-sm">Ładowanie...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111213]">
      <div className="max-w-md mx-auto px-4 pt-14 pb-32">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-sm text-[#666] leading-none mb-1">Moja</p>
            <h1 className="text-[2.625rem] font-extrabold leading-none tracking-tight text-white">
              Lodówka
            </h1>
          </div>
          <button
            onClick={handleSignOut}
            className="text-sm text-[#666] mt-2 active:text-gray-300"
          >
            Wyloguj
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[#252628] rounded-2xl p-4">
            <p className="text-3xl font-bold text-white">{stats.total}</p>
            <p className="text-xs text-[#666] mt-1">Produkty</p>
          </div>
          <div className="bg-[#2D2600] rounded-2xl p-4">
            <p className="text-3xl font-bold text-amber-400">{stats.expiring}</p>
            <p className="text-xs text-amber-600 mt-1">Wygasające</p>
          </div>
          <div className="bg-[#0A2218] rounded-2xl p-4">
            <p className="text-3xl font-bold text-green-400">{stats.fresh}</p>
            <p className="text-xs text-green-700 mt-1">Świeże</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#555]">
            <SearchIcon />
          </div>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj produktu"
            aria-label="Szukaj produktu"
            className="w-full h-12 rounded-full bg-[#252628] pl-11 pr-11 text-sm text-white placeholder:text-[#555] focus:outline-none border-0"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#555] active:text-gray-300"
              aria-label="Wyczyść wyszukiwanie"
            >
              <ClearIcon />
            </button>
          )}
        </div>

        {/* Section label */}
        {products.length > 0 && (
          <p className="text-[11px] font-semibold text-[#555] tracking-[0.12em] uppercase mb-4">
            Wszystkie produkty
          </p>
        )}

        {/* Product grid */}
        {products.length === 0 ? (
          <p className="text-center text-[#555] text-sm py-20">
            Brak produktów. Dotknij +, aby dodać pierwszy.
          </p>
        ) : visibleProducts.length === 0 ? (
          <p className="text-center text-[#555] text-sm py-20">
            Nie znaleziono produktów.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visibleProducts.map((product) => {
              const days = daysUntilExpiry(product.expiration_date);
              const formattedDate = new Date(
                product.expiration_date + "T00:00:00"
              ).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });

              return (
                <div
                  key={product.id}
                  className="bg-[#1C1D1F] rounded-2xl overflow-hidden"
                >
                  {product.image_url ? (
                    <button
                      onClick={() => setImageModal(product.image_url!)}
                      className="block w-full"
                      aria-label="Zobacz zdjęcie"
                    >
                      <Image
                        src={product.image_url}
                        alt={product.name}
                        width={200}
                        height={200}
                        className="w-full aspect-square object-cover"
                      />
                    </button>
                  ) : (
                    <div className="w-full aspect-square bg-[#252628] flex flex-col items-center justify-center gap-1.5">
                      <NoImageIcon />
                      <span className="text-xs text-[#555]">Brak zdjęcia</span>
                    </div>
                  )}
                  <div className="p-3 pt-2.5">
                    <p className="font-semibold text-white text-[13px] leading-snug mb-0.5 line-clamp-2">
                      {product.name}
                    </p>
                    <p className="text-[11px] text-[#666] mb-2.5">
                      {formattedDate}
                    </p>
                    <div className="flex items-center justify-between gap-1">
                      <StatusBadge days={days} />
                      <button
                        onClick={() => handleDelete(product)}
                        disabled={deleting === product.id}
                        className="p-1 text-[#555] active:text-red-400 disabled:opacity-30 flex-shrink-0"
                        aria-label="Usuń"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <Link
        href="/add"
        className="fixed bottom-8 right-6 w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
        aria-label="Dodaj produkt"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-6 h-6 text-[#111213]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>

      {/* Image modal */}
      {imageModal && (
        <div
          className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-6"
          onClick={() => setImageModal(null)}
        >
          <Image
            src={imageModal}
            alt="Zdjęcie produktu"
            width={600}
            height={600}
            className="max-w-full max-h-[80vh] rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
