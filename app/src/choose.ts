import { open } from "@tauri-apps/plugin-dialog";
import { useStore } from "./store";

/** Asks for a folder and opens it. */
export async function chooseFolder() {
  const path = await open({ directory: true, multiple: false, title: "Open a repository" });
  if (typeof path === "string") await useStore.getState().open(path);
}
