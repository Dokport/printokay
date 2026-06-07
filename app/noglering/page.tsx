import { redirect } from "next/navigation";

// Nøglering-konfiguratoren er nu integreret direkte i shoppen.
export default function NøgleringRedirect() {
  redirect("/");
}
