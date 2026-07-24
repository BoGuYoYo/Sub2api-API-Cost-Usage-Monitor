import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const FLOATING_WINDOW_LABEL = "floating-widget";

export async function openFloatingWidget(): Promise<void> {
  const alwaysOnTop = localStorage.getItem("floating_always_on_top") !== "false";
  const existing = await WebviewWindow.getByLabel(FLOATING_WINDOW_LABEL);

  if (existing) {
    await existing.setAlwaysOnTop(alwaysOnTop);
    await existing.show();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    try {
      const widget = new WebviewWindow(FLOATING_WINDOW_LABEL, {
        url: "index.html?window=floating",
        title: "API Monitor Widget",
        width: 320,
        height: 174,
        minWidth: 280,
        minHeight: 150,
        resizable: true,
        decorations: false,
        transparent: true,
        alwaysOnTop,
        skipTaskbar: true,
        shadow: false,
        visible: true,
        center: true,
      });
      widget.once("tauri://created", () => resolve());
      widget.once("tauri://error", (event) => {
        reject(new Error(String(event.payload || "Unable to create widget.")));
      });
    } catch (error) {
      reject(error);
    }
  });
}
