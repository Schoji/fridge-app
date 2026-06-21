"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase-client";

function BackIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-6 h-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-8 h-8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

type ProductName = {
  name: string;
};

function normalizeProductName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueSortedNames(names: string[]): string[] {
  const unique = new Map<string, string>();

  names.forEach((name) => {
    const normalized = normalizeProductName(name);
    if (!normalized) return;
    const key = normalized.toLocaleLowerCase("pl-PL");
    if (!unique.has(key)) unique.set(key, normalized);
  });

  return [...unique.values()].sort((a, b) =>
    a.localeCompare(b, "pl", { sensitivity: "base" })
  );
}

export default function AddPage() {
  const [name, setName] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [knownProductNames, setKnownProductNames] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const suggestedProductNames = useMemo(() => {
    const currentName = normalizeProductName(name).toLocaleLowerCase("pl-PL");
    return knownProductNames.filter(
      (productName) =>
        productName.toLocaleLowerCase("pl-PL") !== currentName
    );
  }, [knownProductNames, name]);

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("products")
      .select("name")
      .order("name", { ascending: true })
      .then(({ data, error: namesError }) => {
        if (!namesError) {
          setKnownProductNames(uniqueSortedNames((data ?? []).map((p) => p.name)));
        }
      });

    const channel = supabase
      .channel("product-name-suggestions")
      .on<ProductName>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "products" },
        (payload) => {
          const newName = payload.new?.name;
          if (!newName) return;
          setKnownProductNames((current) =>
            uniqueSortedNames([...current, newName])
          );
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressing(true);
    try {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
      });
      setImageFile(compressed);
      setImagePreview(URL.createObjectURL(compressed));
    } catch {
      setError("Nie udało się przetworzyć zdjęcia.");
    } finally {
      setCompressing(false);
    }
  }

  function clearImage() {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const trimmedName = normalizeProductName(name);
    if (!trimmedName) {
      setError("Wpisz nazwę produktu.");
      setLoading(false);
      return;
    }

    const supabase = createClient();
    let imageUrl: string | null = null;

    if (imageFile) {
      const ext = imageFile.name.split(".").pop() ?? "jpg";
      const filename = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(filename, imageFile, { contentType: imageFile.type });

      if (uploadError) {
        setError("Nie udało się wysłać zdjęcia. Spróbuj ponownie.");
        setLoading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("product-images")
        .getPublicUrl(filename);

      imageUrl = urlData.publicUrl;
    }

    const { error: insertError } = await supabase.from("products").insert({
      name: trimmedName,
      expiration_date: expirationDate,
      image_url: imageUrl,
    });

    if (insertError) {
      setError("Nie udało się zapisać produktu. Spróbuj ponownie.");
      setLoading(false);
      return;
    }

    router.push("/");
  }

  return (
    <div className="min-h-screen bg-[#111213]">
      <div className="max-w-md mx-auto px-5 pt-14 pb-10">
        {/* Header */}
        <motion.div
          className="flex items-center gap-3 mb-8"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <button
            onClick={() => router.back()}
            className="text-[#666] active:text-gray-300 -ml-1 p-1"
            aria-label="Wróć"
          >
            <BackIcon />
          </button>
          <h1 className="text-2xl font-semibold text-white">
            Dodaj produkt
          </h1>
        </motion.div>

        <motion.form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.1, ease: "easeOut" }}
        >
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-[#666] mb-1.5">
              Nazwa
            </label>
            <input
              type="text"
              placeholder="np. mleko"
              value={name}
              onChange={(e) => setName(e.target.value)}
              list="product-name-suggestions"
              autoComplete="off"
              required
              className="w-full px-4 py-3.5 rounded-2xl border border-[#2A2A2D] bg-[#1C1D1F] text-white text-base placeholder:text-[#555] focus:outline-none focus:border-[#444]"
            />
            <datalist id="product-name-suggestions">
              {suggestedProductNames.map((productName) => (
                <option key={productName} value={productName} />
              ))}
            </datalist>
          </div>

          {/* Expiration date */}
          <div>
            <label className="block text-sm font-medium text-[#666] mb-1.5">
              Data ważności
            </label>
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              required
              style={{ colorScheme: "dark" }}
              className="w-full px-4 py-3.5 rounded-2xl border border-[#2A2A2D] bg-[#1C1D1F] text-white text-base focus:outline-none focus:border-[#444]"
            />
          </div>

          {/* Photo */}
          <div>
            <label className="block text-sm font-medium text-[#666] mb-1.5">
              Zdjęcie{" "}
              <span className="text-[#444] font-normal">(opcjonalnie)</span>
            </label>

            {imagePreview ? (
              <div className="relative rounded-2xl overflow-hidden">
                <Image
                  src={imagePreview}
                  alt="Podgląd zdjęcia"
                  width={400}
                  height={240}
                  className="w-full h-52 object-cover"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-3 right-3 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white active:bg-black/80"
                  aria-label="Usuń zdjęcie"
                >
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
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={compressing}
                className="w-full h-36 rounded-2xl border-2 border-dashed border-[#333] bg-[#1C1D1F] flex flex-col items-center justify-center gap-2 text-[#555] active:border-[#555] disabled:opacity-50"
              >
                <CameraIcon />
                <span className="text-sm">
                  {compressing
                    ? "Przetwarzanie..."
                    : "Zrób zdjęcie albo wybierz z galerii"}
                </span>
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageChange}
              className="hidden"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || compressing}
            className="w-full py-3.5 rounded-2xl bg-green-500 text-white font-semibold text-base disabled:opacity-50 mt-1 active:scale-[0.98] transition-transform"
          >
            {loading ? "Zapisywanie..." : "Dodaj produkt"}
          </button>
        </motion.form>
      </div>
    </div>
  );
}
