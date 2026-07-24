import { useEffect, useState, type FormEvent } from "react";
import { Save, X } from "lucide-react";
import {
  getConfiguredApiUrl,
  normalizeApiBaseUrl,
  saveApiBaseUrl,
} from "../lib/api";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (url: string) => void;
}

export default function SettingsModal({
  open,
  onClose,
  onSaved,
}: SettingsModalProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValue(getConfiguredApiUrl());
      setError("");
    }
  }, [open]);

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const normalized = normalizeApiBaseUrl(value);
      saveApiBaseUrl(normalized);
      onSaved?.(normalized);
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Invalid URL.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-md rounded-2xl border border-white/[0.14] bg-[#242143]/95 p-6 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="settings-title" className="text-lg font-medium text-white/90">
              Connection Settings
            </h2>
            <p className="mt-1 text-xs leading-5 text-white/45">
              Connect to any compatible Sub2API website.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close settings"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="api-base-url"
              className="mb-2 block text-xs font-medium uppercase tracking-wider text-white/55"
            >
              Sub2API website URL
            </label>
            <input
              id="api-base-url"
              type="text"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://example.com"
              autoFocus
              className="w-full rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 text-sm text-white/90 outline-none transition-all placeholder:text-white/25 focus:border-white/30 focus:bg-white/[0.10]"
            />
            <p className="mt-2 text-[11px] leading-4 text-white/35">
              You can enter the site URL or its /api/v1 endpoint.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/15"
            >
              <Save size={15} />
              Save URL
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
