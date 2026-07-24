import { Settings, X, Minus } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

interface TitleBarProps {
  onSettings?: () => void;
}

export default function TitleBar({ onSettings }: TitleBarProps) {
  async function handleDragStart(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // The data attribute remains as a fallback for supported Tauri runtimes.
    }
  }

  return (
    <div className="flex items-center justify-between h-9 px-3 bg-black/20 backdrop-blur-md shrink-0">
      {/* Drag region - only the title area */}
      <div
        data-tauri-drag-region
        onMouseDown={handleDragStart}
        className="flex-1 h-full flex items-center"
      >
        <span className="text-xs text-white/50 font-medium tracking-wider select-none">
          API MONITOR
        </span>
      </div>

      {/* Window controls - outside drag region */}
      <div className="flex items-center gap-1">
        {onSettings && (
          <button
            type="button"
            aria-label="Open settings"
            title="Settings"
            onClick={onSettings}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/80"
          >
            <Settings size={14} />
          </button>
        )}
        <button
          type="button"
          aria-label="Hide to system tray"
          title="Hide to system tray"
          onClick={async () => {
            try {
              await getCurrentWindow().hide();
            } catch {}
          }}
          className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-white/10 text-white/40 hover:text-white/80 transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label="Close window"
          title="Close"
          onClick={async () => {
            try {
              await getCurrentWindow().close();
            } catch {}
          }}
          className="flex items-center justify-center w-7 h-7 rounded-full hover:bg-white/10 text-white/40 hover:text-red-400/70 transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
