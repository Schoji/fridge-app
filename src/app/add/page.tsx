"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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

export default function AddPage() {
  const [name, setName] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressing(true);
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
      });
      setImageFile(compressed);
      setImagePreview(URL.createObjectURL(compressed));
    } catch {
      setError("Failed to process image.");
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

    const supabase = createClient();
    let imageUrl: string | null = null;

    if (imageFile) {
      const ext = imageFile.name.split(".").pop() ?? "jpg";
      const filename = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(filename, imageFile, { contentType: imageFile.type });

      if (uploadError) {
        setError("Failed to upload image. Please try again.");
        setLoading(false);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("product-images")
        .getPublicUrl(filename);

      imageUrl = urlData.publicUrl;
    }

    const { error: insertError } = await supabase.from("products").insert({
      name: name.trim(),
      expiration_date: expirationDate,
      image_url: imageUrl,
    });

    if (insertError) {
      setError("Failed to save product. Please try again.");
      setLoading(false);
      return;
    }

    router.push("/");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-md mx-auto px-5 pt-14 pb-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => router.back()}
            className="text-gray-400 active:text-gray-600 -ml-1 p-1"
          >
            <BackIcon />
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">Add product</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">
              Name
            </label>
            <input
              type="text"
              placeholder="e.g. Milk"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-900 text-base placeholder:text-gray-300 focus:outline-none focus:border-gray-400"
            />
          </div>

          {/* Expiration date */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">
              Expiration date
            </label>
            <input
              type="date"
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              required
              className="w-full px-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-gray-900 text-base focus:outline-none focus:border-gray-400"
            />
          </div>

          {/* Photo */}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1.5">
              Photo{" "}
              <span className="text-gray-300 font-normal">(optional)</span>
            </label>

            {imagePreview ? (
              <div className="relative rounded-2xl overflow-hidden">
                <Image
                  src={imagePreview}
                  alt="Preview"
                  width={400}
                  height={240}
                  className="w-full h-52 object-cover"
                />
                <button
                  type="button"
                  onClick={clearImage}
                  className="absolute top-3 right-3 w-8 h-8 bg-black/50 rounded-full flex items-center justify-center text-white active:bg-black/70"
                  aria-label="Remove photo"
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
                className="w-full h-36 rounded-2xl border-2 border-dashed border-gray-200 bg-white flex flex-col items-center justify-center gap-2 text-gray-300 active:border-gray-300 disabled:opacity-50"
              >
                <CameraIcon />
                <span className="text-sm">
                  {compressing
                    ? "Processing…"
                    : "Take photo or choose from library"}
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

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || compressing}
            className="w-full py-3.5 rounded-2xl bg-gray-900 text-white font-medium text-base disabled:opacity-50 mt-1 active:scale-[0.98] transition-transform"
          >
            {loading ? "Saving…" : "Add product"}
          </button>
        </form>
      </div>
    </div>
  );
}
