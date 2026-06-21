"use client";

import { useCallback, useEffect, useState } from "react";
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

function daysUntilExpiry(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(dateStr + "T00:00:00");
  return Math.round(
    (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function ExpiryLabel({ days }: { days: number }) {
  if (days < 0)
    return (
      <span className="text-red-500 text-sm font-medium">
        Po terminie od {Math.abs(days)}{" "}
        {Math.abs(days) === 1 ? "dnia" : "dni"}
      </span>
    );
  if (days === 0)
    return (
      <span className="text-orange-500 text-sm font-medium">
        Termin mija dzisiaj
      </span>
    );
  if (days <= 3)
    return (
      <span className="text-orange-500 text-sm font-medium">
        Pozostało {days} {days === 1 ? "dzień" : "dni"}
      </span>
    );
  return <span className="text-gray-400 text-sm">Pozostało {days} dni</span>;
}

function cardStyle(days: number): string {
  if (days < 0) return "border-l-[3px] border-red-400 bg-red-50";
  if (days <= 3) return "border-l-[3px] border-orange-400 bg-orange-50";
  return "border-l-[3px] border-gray-100 bg-white";
}

function sortProducts(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const dateCompare = a.expiration_date.localeCompare(b.expiration_date);
    if (dateCompare !== 0) return dateCompare;
    return a.name.localeCompare(b.name, "pl", { sensitivity: "base" });
  });
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
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

export default function HomePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);
  const router = useRouter();

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
      .subscribe();

    return () => {
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-300 text-sm">Ładowanie...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-14 pb-5">
          <h1 className="text-2xl font-semibold text-gray-900">Lodówka</h1>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-400 active:text-gray-600"
          >
            Wyloguj
          </button>
        </div>

        {/* List */}
        <div className="px-4 flex flex-col gap-2.5 pb-28">
          {products.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-20">
              Brak produktów. Dotknij +, aby dodać pierwszy.
            </p>
          ) : (
            products.map((product) => {
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
                  className={`flex items-center rounded-2xl shadow-sm overflow-hidden ${cardStyle(days)}`}
                >
                  <div className="flex-1 py-4 pl-4 pr-3 min-w-0">
                    <p className="font-medium text-gray-900 text-[15px] truncate">
                      {product.name}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <ExpiryLabel days={days} />
                      <span className="text-gray-300 text-sm">·</span>
                      <span className="text-gray-400 text-sm">
                        {formattedDate}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 pr-2 flex-shrink-0">
                    {product.image_url && (
                      <button
                        onClick={() => setImageModal(product.image_url!)}
                        className="w-11 h-11 rounded-xl overflow-hidden"
                        aria-label="Zobacz zdjęcie"
                      >
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          width={44}
                          height={44}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(product)}
                      disabled={deleting === product.id}
                      className="p-2.5 text-gray-300 active:text-red-400 disabled:opacity-30"
                      aria-label="Usuń"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* FAB */}
      <Link
        href="/add"
        className="fixed bottom-8 right-6 w-14 h-14 bg-gray-900 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-transform"
        aria-label="Dodaj produkt"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-6 h-6 text-white"
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
          className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-6"
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
