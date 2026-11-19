"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { compressImage, fileUrl, uploadFile } from "@/lib/client/image";

interface ImageUploadProps {
  value: string | null;
  onChange: (key: string | null) => void;
  label?: string;
}

/** Compresses the photo in the browser (WebP, max 800px) and uploads it to file storage, not the database. */
export function ImageUpload({ value, onChange, label = "Product photo" }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file");
      return;
    }
    setIsUploading(true);
    try {
      const compressed = await compressImage(file);
      const key = await uploadFile(compressed, "products", `${file.name.replace(/\.[^.]+$/, "")}.webp`);
      onChange(key);
      toast.success(`Photo uploaded (${Math.round(compressed.size / 1024)} KB)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted/50">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated file route, already compressed
          <img src={fileUrl(value)} alt={label} className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => inputRef.current?.click()}>
            {isUploading ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
            {value ? "Replace" : "Upload"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <Trash2 aria-hidden /> Remove
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">Compressed automatically before upload.</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
