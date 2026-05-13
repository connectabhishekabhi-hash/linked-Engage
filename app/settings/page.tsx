import { redirect } from "next/navigation";

// Settings moved to /dashboard/settings (now lives inside the sidebar layout)
export default function SettingsRedirect() {
  redirect("/dashboard/settings");
}
